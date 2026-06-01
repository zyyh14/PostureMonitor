import json
import math
import random
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from matplotlib import font_manager
import matplotlib.pyplot as plt

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "data.csv"
SUBJECT_SPLIT_PATH = BASE_DIR / "subject_split_plan.csv"
ROW_SPLIT_PATH = BASE_DIR / "row_split_plan.csv"
OUTPUT_MD = BASE_DIR / "kan_svm_experiment_report.md"
OUTPUT_JSON = BASE_DIR / "kan_svm_metrics.json"
OUTPUT_IMG_GLOBAL = BASE_DIR / "kan_training_curve.png"
OUTPUT_IMG_PER_SUBJECT = BASE_DIR / "kan_svm_subject_compare.png"
RUNTIME_MODEL_PATH = BASE_DIR.parent / "久坐人群体态监测与可视化系统" / "src" / "lib" / "kan_model_artifact.json"

LABELS = ["TUP", "TLF", "TLB", "TLR", "TLL"]
LABEL_CN = {
    "TUP": "端正坐姿",
    "TLF": "身体前倾/探颈",
    "TLB": "身体后仰/瘫坐",
    "TLR": "身体向右歪斜",
    "TLL": "身体向左歪斜",
}
FEATURE_COLS = [
    "neck_angle",
    "head_depth_delta",
    "depth_delta",
    "torso_tilt",
    "shoulder_diff",
    "shoulder_width",
    "signed_tilt",
]


def configure_chinese_font():
    candidates = ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "Arial Unicode MS"]
    available = {f.name for f in font_manager.fontManager.ttflist}
    for font_name in candidates:
        if font_name in available:
            plt.rcParams["font.sans-serif"] = [font_name]
            break
    plt.rcParams["axes.unicode_minus"] = False


def seed_everything(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


def safe_div(a, b):
    return a / b if b else 0.0


def extract_features(row):
    mid_sh_x = (row["left_shoulder_x"] + row["right_shoulder_x"]) / 2
    mid_sh_y = (row["left_shoulder_y"] + row["right_shoulder_y"]) / 2
    mid_sh_z = (row["left_shoulder_z"] + row["right_shoulder_z"]) / 2
    mid_hip_x = (row["left_hip_x"] + row["right_hip_x"]) / 2
    mid_hip_y = (row["left_hip_y"] + row["right_hip_y"]) / 2
    mid_hip_z = (row["left_hip_z"] + row["right_hip_z"]) / 2

    neck_dx = abs(row["nose_x"] - mid_sh_x)
    neck_dy = abs(row["nose_y"] - mid_sh_y)
    neck_angle = math.degrees(math.atan(neck_dx / max(neck_dy, 1e-6)))
    torso_tilt = math.degrees(
        math.atan(abs(mid_sh_x - mid_hip_x) / max(abs(mid_sh_y - mid_hip_y), 1e-6))
    )
    signed_tilt = mid_sh_x - mid_hip_x
    head_depth_delta = row["nose_z"] - mid_sh_z
    depth_delta = mid_sh_z - mid_hip_z
    shoulder_diff = abs(row["left_shoulder_y"] - row["right_shoulder_y"]) * 480
    shoulder_width = math.sqrt(
        (row["left_shoulder_x"] - row["right_shoulder_x"]) ** 2
        + (row["left_shoulder_y"] - row["right_shoulder_y"]) ** 2
        + (row["left_shoulder_z"] - row["right_shoulder_z"]) ** 2
    )
    return {
        "neck_angle": neck_angle,
        "head_depth_delta": head_depth_delta,
        "depth_delta": depth_delta,
        "torso_tilt": torso_tilt,
        "shoulder_diff": shoulder_diff,
        "shoulder_width": shoulder_width,
        "signed_tilt": signed_tilt,
    }


def build_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    feats = []
    for _, row in df.iterrows():
        feat = extract_features(row)
        feat["row_id"] = int(row["row_id"])
        feat["subject"] = int(row["subject"])
        feat["upperbody_label"] = row["upperbody_label"]
        feats.append(feat)
    return pd.DataFrame(feats)


class TabularKAN(nn.Module):
    def __init__(self, in_features: int, num_classes: int, num_knots: int = 9):
        super().__init__()
        self.in_features = in_features
        self.num_classes = num_classes
        self.num_knots = num_knots
        self.register_buffer("grid", torch.linspace(-3.0, 3.0, num_knots))
        self.spline_coef = nn.Parameter(torch.zeros(in_features, num_knots, num_classes))
        self.linear = nn.Linear(in_features, num_classes)
        self.bias = nn.Parameter(torch.zeros(num_classes))
        nn.init.normal_(self.spline_coef, mean=0.0, std=0.02)
        nn.init.xavier_uniform_(self.linear.weight)
        nn.init.zeros_(self.linear.bias)

    def _basis(self, x: torch.Tensor) -> torch.Tensor:
        # x: [B, F]
        # 对每个特征值在一维 knot 网格上做线性插值，形成可学习的分段基函数。
        grid = self.grid
        x_clamped = x.clamp(grid[0].item(), grid[-1].item())
        flat = x_clamped.reshape(-1)
        idx = torch.searchsorted(grid, flat, right=True)
        idx = idx.clamp(1, self.num_knots - 1)
        left = idx - 1
        right = idx
        left_x = grid[left]
        right_x = grid[right]
        denom = (right_x - left_x).clamp_min(1e-6)
        t = (flat - left_x) / denom
        basis = torch.zeros(flat.shape[0], self.num_knots, device=x.device, dtype=x.dtype)
        basis.scatter_add_(1, left.unsqueeze(1), (1 - t).unsqueeze(1))
        basis.scatter_add_(1, right.unsqueeze(1), t.unsqueeze(1))
        basis = basis.view(x.shape[0], x.shape[1], self.num_knots)
        return basis

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        basis = self._basis(x)  # [B, F, K]
        spline_logits = torch.einsum("bfk,fkc->bc", basis, self.spline_coef)
        return spline_logits + self.linear(x) + self.bias


def train_kan(model, train_x, train_y, val_x, val_y, class_weights, epochs=220, batch_size=128, lr=0.01, patience=25):
    device = torch.device("cpu")
    model = model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss(weight=class_weights.to(device))
    train_ds = torch.utils.data.TensorDataset(train_x, train_y)
    train_loader = torch.utils.data.DataLoader(train_ds, batch_size=batch_size, shuffle=True)

    best_state = None
    best_val_acc = -1.0
    best_epoch = 0
    no_improve = 0
    history = []

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for xb, yb in train_loader:
            xb = xb.to(device)
            yb = yb.to(device)
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 3.0)
            optimizer.step()
            total_loss += loss.item() * len(xb)

        train_loss = total_loss / len(train_ds)
        val_logits = predict_logits(model, val_x)
        val_pred = val_logits.argmax(dim=1).cpu().numpy()
        val_true = val_y.cpu().numpy()
        val_acc = accuracy_score(val_true, val_pred)
        history.append({"epoch": epoch, "train_loss": train_loss, "val_acc": val_acc})

        if val_acc > best_val_acc + 1e-4:
            best_val_acc = val_acc
            best_epoch = epoch
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1

        if no_improve >= patience:
            break

    if best_state is not None:
        model.load_state_dict(best_state)
    return model, history, best_epoch, best_val_acc


@torch.no_grad()
def predict_logits(model, x):
    model.eval()
    return model(x)


def to_tensor(x: np.ndarray, y: Optional[np.ndarray] = None):
    tx = torch.tensor(x, dtype=torch.float32)
    if y is None:
        return tx
    ty = torch.tensor(y, dtype=torch.long)
    return tx, ty


def plot_training_curve(history, output_path):
    epochs = [h["epoch"] for h in history]
    losses = [h["train_loss"] for h in history]
    accs = [h["val_acc"] for h in history]
    fig, ax1 = plt.subplots(figsize=(10, 5))
    ax1.plot(epochs, losses, color="#38bdf8", label="训练损失", linewidth=2)
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax1.grid(alpha=0.25)
    ax2 = ax1.twinx()
    ax2.plot(epochs, accs, color="#10b981", label="验证准确率", linewidth=2)
    ax2.set_ylabel("Accuracy")
    ax2.set_ylim(0, 1.05)
    ax1.set_title("KAN 训练曲线", fontsize=14, fontweight="bold")
    fig.tight_layout()
    plt.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)


def plot_subject_compare(rows, output_path):
    subjects = [str(r["subject"]) for r in rows]
    kan_only = [r["kan_acc"] for r in rows]
    ensemble = [r["ensemble_acc"] for r in rows]
    svm_only = [r["svm_acc"] for r in rows]
    x = np.arange(len(subjects))
    w = 0.24
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.bar(x - w, kan_only, width=w, label="KAN", color="#38bdf8")
    ax.bar(x, svm_only, width=w, label="SVM", color="#f59e0b")
    ax.bar(x + w, ensemble, width=w, label="KAN+SVM", color="#10b981")
    ax.set_xticks(x)
    ax.set_xticklabels(subjects)
    ax.set_ylim(0, 1.05)
    ax.set_xlabel("新用户 subject")
    ax.set_ylabel("Accuracy")
    ax.set_title("个性化新用户效果对比")
    ax.grid(axis="y", alpha=0.25)
    ax.legend(frameon=False)
    plt.tight_layout()
    plt.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)


def export_runtime_model(model, scaler: StandardScaler, output_path: Path):
    artifact = {
        "model_type": "tabular_kan",
        "labels": LABELS,
        "feature_cols": FEATURE_COLS,
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "kan": {
            "grid": model.grid.detach().cpu().tolist(),
            "spline_coef": model.spline_coef.detach().cpu().tolist(),
            "linear_weight": model.linear.weight.detach().cpu().tolist(),
            "linear_bias": model.linear.bias.detach().cpu().tolist(),
            "bias": model.bias.detach().cpu().tolist(),
        },
        "runtime": {
            "target_subjects": [7, 8, 9],
            "calibration_source": "TUP",
            "special_subjects": [7, 8, 9],
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, ensure_ascii=False, indent=2)


def make_group_mask(split_df, group_name):
    return split_df["split_group"] == group_name


def subject_shift(global_train_feat, calib_feat, shrink=0.7):
    # 用 TUP 中立标定样本估计个体偏移，向全局中立中心收缩，避免少量样本过拟合。
    global_tup = global_train_feat[global_train_feat["upperbody_label"] == "TUP"][FEATURE_COLS]
    if len(global_tup) == 0:
        global_tup = global_train_feat[FEATURE_COLS]
    gmean = global_tup.mean()
    cmean = calib_feat[FEATURE_COLS].mean()
    shift = (cmean - gmean) * shrink
    return shift


def apply_shift_and_scale(df_feat, shift, scaler: StandardScaler):
    raw = df_feat[FEATURE_COLS].copy()
    adjusted = raw - shift
    z = scaler.transform(adjusted.values)
    return z


def combine_probs(kan_probs, svm_probs, kan_weight=0.65):
    return kan_weight * kan_probs + (1.0 - kan_weight) * svm_probs


def eval_predictions(y_true, y_pred):
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro")),
        "weighted_f1": float(f1_score(y_true, y_pred, average="weighted")),
        "cm": confusion_matrix(y_true, y_pred, labels=LABELS).tolist(),
        "report": classification_report(y_true, y_pred, labels=LABELS, output_dict=True, zero_division=0),
    }


def main():
    configure_chinese_font()
    seed_everything(42)

    df = pd.read_csv(CSV_PATH)
    df = df.reset_index().rename(columns={"index": "row_id"})
    split_df = pd.read_csv(ROW_SPLIT_PATH)
    merged = df.merge(split_df[["row_id", "split_group"]], on="row_id", how="left")
    if merged["split_group"].isna().any():
        raise ValueError("Some rows are missing split_group assignments.")

    feats = build_feature_frame(merged)
    feats = feats.merge(merged[["row_id", "split_group"]], on="row_id", how="left")

    global_train = feats[feats["split_group"] == "global_train"].copy().reset_index(drop=True)
    global_val = feats[feats["split_group"] == "global_val"].copy().reset_index(drop=True)
    personal_calib = feats[feats["split_group"] == "personal_calibration"].copy().reset_index(drop=True)
    personal_eval = feats[feats["split_group"] == "personal_eval"].copy().reset_index(drop=True)

    scaler = StandardScaler()
    scaler.fit(global_train[FEATURE_COLS].values)
    x_train = scaler.transform(global_train[FEATURE_COLS].values)
    x_val = scaler.transform(global_val[FEATURE_COLS].values)

    label_to_idx = {l: i for i, l in enumerate(LABELS)}
    idx_to_label = {i: l for l, i in label_to_idx.items()}
    y_train = global_train["upperbody_label"].map(label_to_idx).values
    y_val = global_val["upperbody_label"].map(label_to_idx).values

    class_counts = np.bincount(y_train, minlength=len(LABELS))
    class_weights = torch.tensor([safe_div(len(y_train), max(1, c)) for c in class_counts], dtype=torch.float32)

    train_x_t, train_y_t = to_tensor(x_train, y_train)
    val_x_t, val_y_t = to_tensor(x_val, y_val)

    kan = TabularKAN(in_features=len(FEATURE_COLS), num_classes=len(LABELS), num_knots=11)
    kan, history, best_epoch, best_val_acc = train_kan(
        kan, train_x_t, train_y_t, val_x_t, val_y_t, class_weights,
        epochs=220, batch_size=128, lr=0.012, patience=28
    )

    plot_training_curve(history, OUTPUT_IMG_GLOBAL)

    svm = SVC(kernel="linear", probability=True, class_weight="balanced", C=1.0, random_state=42)
    svm.fit(x_train, y_train)

    def predict_batch(frame: pd.DataFrame, subject_id: Optional[int] = None):
        if subject_id is None:
            shift = pd.Series(0.0, index=FEATURE_COLS)
        else:
            calib_subject = personal_calib[personal_calib["subject"] == subject_id].copy()
            if len(calib_subject) == 0:
                shift = pd.Series(0.0, index=FEATURE_COLS)
            else:
                shift = subject_shift(global_train, calib_subject, shrink=0.7)
        z = apply_shift_and_scale(frame, shift, scaler)
        z_t = torch.tensor(z, dtype=torch.float32)
        with torch.no_grad():
            kan_logits = predict_logits(kan, z_t)
            kan_probs = torch.softmax(kan_logits, dim=1).cpu().numpy()
        svm_probs = svm.predict_proba(z)
        ensemble_probs = combine_probs(kan_probs, svm_probs, kan_weight=0.7)
        kan_pred = [idx_to_label[int(i)] for i in kan_probs.argmax(axis=1)]
        svm_pred = [idx_to_label[int(i)] for i in svm_probs.argmax(axis=1)]
        ens_pred = [idx_to_label[int(i)] for i in ensemble_probs.argmax(axis=1)]
        return {
            "kan_pred": kan_pred,
            "svm_pred": svm_pred,
            "ensemble_pred": ens_pred,
            "kan_probs": kan_probs,
            "svm_probs": svm_probs,
            "ensemble_probs": ensemble_probs,
        }

    # Global validation
    global_val_pred = predict_batch(global_val)
    global_val_metrics_kan = eval_predictions(global_val["upperbody_label"].tolist(), global_val_pred["kan_pred"])
    global_val_metrics_svm = eval_predictions(global_val["upperbody_label"].tolist(), global_val_pred["svm_pred"])
    global_val_metrics_ens = eval_predictions(global_val["upperbody_label"].tolist(), global_val_pred["ensemble_pred"])

    # Personalized test on 3 special subjects
    subject_rows = []
    subject_metrics = []
    special_subjects = [7, 8, 9]
    for subject_id in special_subjects:
        subj_eval = personal_eval[personal_eval["subject"] == subject_id].copy().reset_index(drop=True)
        subj_pred = predict_batch(subj_eval, subject_id=subject_id)
        y_true = subj_eval["upperbody_label"].tolist()
        kan_metrics = eval_predictions(y_true, subj_pred["kan_pred"])
        svm_metrics = eval_predictions(y_true, subj_pred["svm_pred"])
        ens_metrics = eval_predictions(y_true, subj_pred["ensemble_pred"])
        subject_metrics.append({
            "subject": int(subject_id),
            "kan_acc": kan_metrics["accuracy"],
            "svm_acc": svm_metrics["accuracy"],
            "ensemble_acc": ens_metrics["accuracy"],
            "kan_macro_f1": kan_metrics["macro_f1"],
            "svm_macro_f1": svm_metrics["macro_f1"],
            "ensemble_macro_f1": ens_metrics["macro_f1"],
            "eval_count": len(subj_eval),
        })
        subject_rows.append({
            "subject": int(subject_id),
            "n_eval": len(subj_eval),
            "kan_acc": kan_metrics["accuracy"],
            "svm_acc": svm_metrics["accuracy"],
            "ensemble_acc": ens_metrics["accuracy"],
        })

    plot_subject_compare(subject_rows, OUTPUT_IMG_PER_SUBJECT)

    avg_kan = float(np.mean([r["kan_acc"] for r in subject_metrics]))
    avg_svm = float(np.mean([r["svm_acc"] for r in subject_metrics]))
    avg_ens = float(np.mean([r["ensemble_acc"] for r in subject_metrics]))
    avg_kan_f1 = float(np.mean([r["kan_macro_f1"] for r in subject_metrics]))
    avg_svm_f1 = float(np.mean([r["svm_macro_f1"] for r in subject_metrics]))
    avg_ens_f1 = float(np.mean([r["ensemble_macro_f1"] for r in subject_metrics]))

    metrics = {
        "global_validation": {
            "kan": global_val_metrics_kan,
            "svm": global_val_metrics_svm,
            "ensemble": global_val_metrics_ens,
            "best_epoch": best_epoch,
            "best_val_acc": best_val_acc,
        },
        "personalized_test": {
            "subjects": subject_metrics,
            "mean_accuracy": {
                "kan": avg_kan,
                "svm": avg_svm,
                "ensemble": avg_ens,
            },
            "mean_macro_f1": {
                "kan": avg_kan_f1,
                "svm": avg_svm_f1,
                "ensemble": avg_ens_f1,
            },
        },
        "split_counts": {
            "global_train": int(len(global_train)),
            "global_val": int(len(global_val)),
            "personal_calibration": int(len(personal_calib)),
            "personal_eval": int(len(personal_eval)),
        },
        "special_subjects": special_subjects,
        "features": FEATURE_COLS,
        "model": "KAN + linear SVM",
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    lines = [
        "# KAN + SVM 训练与测试报告",
        "",
        "> 本报告基于第一步的无泄露划分结果，采用全局 KAN + 线性 SVM + 个性化中立标定的混合架构。",
        "",
        "## 1. 数据划分",
        "",
        f"- 全局训练样本：{metrics['split_counts']['global_train']}",
        f"- 全局验证样本：{metrics['split_counts']['global_val']}",
        f"- 个性化标定样本：{metrics['split_counts']['personal_calibration']}",
        f"- 个性化评估样本：{metrics['split_counts']['personal_eval']}",
        f"- 新用户 subject：{', '.join(map(str, special_subjects))}",
        "",
        "## 2. 全局模型验证",
        "",
        "| 模型 | Accuracy | Macro F1 | 说明 |",
        "|:----:|:--------:|:--------:|:----:|",
        f"| KAN | {global_val_metrics_kan['accuracy']*100:.2f}% | {global_val_metrics_kan['macro_f1']*100:.2f}% | 全局模型 |",
        f"| SVM | {global_val_metrics_svm['accuracy']*100:.2f}% | {global_val_metrics_svm['macro_f1']*100:.2f}% | 全局线性分类器 |",
        f"| KAN+SVM | {global_val_metrics_ens['accuracy']*100:.2f}% | {global_val_metrics_ens['macro_f1']*100:.2f}% | 融合输出 |",
        "",
        f"- KAN 最佳 epoch：{best_epoch}",
        f"- KAN 验证最佳准确率：{best_val_acc*100:.2f}%",
        "",
        "## 3. 新用户个性化测试",
        "",
        "| subject | Eval数 | KAN | SVM | KAN+SVM |",
        "|:------:|:------:|:---:|:---:|:-------:|",
    ]
    for r in subject_metrics:
        lines.append(
            f"| {r['subject']} | {r['eval_count']} | {r['kan_acc']*100:.2f}% | {r['svm_acc']*100:.2f}% | {r['ensemble_acc']*100:.2f}% |"
        )

    lines += [
        "",
        "### 平均结果",
        "",
        f"- KAN 平均准确率：{avg_kan*100:.2f}%",
        f"- SVM 平均准确率：{avg_svm*100:.2f}%",
        f"- KAN+SVM 平均准确率：{avg_ens*100:.2f}%",
        f"- KAN 平均 Macro-F1：{avg_kan_f1*100:.2f}%",
        f"- SVM 平均 Macro-F1：{avg_svm_f1*100:.2f}%",
        f"- KAN+SVM 平均 Macro-F1：{avg_ens_f1*100:.2f}%",
        "",
        f"![训练曲线]({OUTPUT_IMG_GLOBAL})",
        "",
        f"![新用户效果对比]({OUTPUT_IMG_PER_SUBJECT})",
        "",
        "## 4. 说明",
        "",
        "- KAN 与 SVM 都仅使用全局训练 subject 进行拟合，未见新用户 subject 7、8、9 参与训练。",
        "- 新用户仅使用自身 `TUP` 标定样本计算个性化偏移，再对其剩余样本做测试。",
        "- 因此该实验流程满足 subject-level 无泄露约束。",
        "",
        "## 5. 输出文件",
        "",
        f"| 文件 | 说明 |",
        f"|:----:|:----:|",
        f"| `{OUTPUT_JSON}` | 详细指标与分组统计 |",
        f"| `{OUTPUT_IMG_GLOBAL}` | KAN 训练曲线 |",
        f"| `{OUTPUT_IMG_PER_SUBJECT}` | 新用户对比图 |",
        "",
    ]

    with open(OUTPUT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    export_runtime_model(kan, scaler, RUNTIME_MODEL_PATH)

    print(f"Global validation KAN acc: {global_val_metrics_kan['accuracy']*100:.2f}%")
    print(f"Global validation SVM acc: {global_val_metrics_svm['accuracy']*100:.2f}%")
    print(f"Global validation ENS acc: {global_val_metrics_ens['accuracy']*100:.2f}%")
    print(f"Personalized mean KAN acc: {avg_kan*100:.2f}%")
    print(f"Personalized mean SVM acc: {avg_svm*100:.2f}%")
    print(f"Personalized mean ENS acc: {avg_ens*100:.2f}%")
    print(f"Report saved to: {OUTPUT_MD}")
    print(f"Runtime model saved to: {RUNTIME_MODEL_PATH}")


if __name__ == "__main__":
    main()
