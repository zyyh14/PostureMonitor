import math
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib import font_manager

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "data.csv"

OUTPUT_REPORT = BASE_DIR / "data_partition_report.md"
OUTPUT_SUBJECT_SCORE = BASE_DIR / "subject_specialness.csv"
OUTPUT_SUBJECT_SPLIT = BASE_DIR / "subject_split_plan.csv"
OUTPUT_ROW_SPLIT = BASE_DIR / "row_split_plan.csv"
OUTPUT_RANKING_IMG = BASE_DIR / "subject_specialness_ranking.png"
OUTPUT_SPLIT_IMG = BASE_DIR / "subject_split_overview.png"
FIXED_PERSONAL_TEST_SUBJECTS = {7, 8, 9}

LABELS = ["TUP", "TLF", "TLB", "TLR", "TLL"]
LABEL_CN = {
    "TUP": "端正坐姿",
    "TLF": "身体前倾/探颈",
    "TLB": "身体后仰/瘫坐",
    "TLR": "身体向右歪斜",
    "TLL": "身体向左歪斜",
}
FEATURE_KEYS = [
    "neck_angle",
    "head_depth_delta",
    "depth_delta",
    "torso_tilt",
    "shoulder_diff",
    "shoulder_width",
]


def configure_chinese_font():
    candidates = ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "Arial Unicode MS"]
    available = {f.name for f in font_manager.fontManager.ttflist}
    for font_name in candidates:
        if font_name in available:
            plt.rcParams["font.sans-serif"] = [font_name]
            break
    plt.rcParams["axes.unicode_minus"] = False


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
    }


def build_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    feature_rows = []
    for idx, row in df.iterrows():
        feat = extract_features(row)
        feat["row_id"] = idx
        feat["subject"] = row["subject"]
        feat["upperbody_label"] = row["upperbody_label"]
        feature_rows.append(feat)
    return pd.DataFrame(feature_rows)


def zscore_distance(subject_mean: pd.Series, global_mean: pd.Series, global_std: pd.Series) -> tuple[float, dict]:
    z_values = {}
    total = 0.0
    for key in FEATURE_KEYS:
        z = (subject_mean[key] - global_mean[key]) / max(global_std[key], 1e-6)
        z_values[f"z_{key}"] = z
        total += float(z * z)
    return math.sqrt(total), z_values


def compute_subject_specialness(df: pd.DataFrame):
    feats = build_feature_frame(df)
    tup_feats = feats[feats["upperbody_label"] == "TUP"].copy()
    if tup_feats.empty:
        raise ValueError("No TUP samples found. Cannot compute calibration-based specialness.")

    global_mean = tup_feats[FEATURE_KEYS].mean()
    global_std = tup_feats[FEATURE_KEYS].std(ddof=0).replace(0, 1e-6)

    rows = []
    for subject, subj_df in feats.groupby("subject"):
        subj_tup = subj_df[subj_df["upperbody_label"] == "TUP"]
        if subj_tup.empty:
            subj_tup = subj_df
        mean_vec = subj_tup[FEATURE_KEYS].mean()
        score, z_values = zscore_distance(mean_vec, global_mean, global_std)
        class_counts = subj_df["upperbody_label"].value_counts().reindex(LABELS, fill_value=0)
        rows.append({
            "subject": subject,
            "specialness_score": round(score, 4),
            "tup_count": int(class_counts["TUP"]),
            "total_count": int(len(subj_df)),
            "calibration_source": "TUP only",
            **{f"mean_{k}": round(float(mean_vec[k]), 6) for k in FEATURE_KEYS},
            **{k: round(float(v), 6) for k, v in z_values.items()},
            **{f"label_count_{label.lower()}": int(class_counts[label]) for label in LABELS},
        })

    score_df = pd.DataFrame(rows).sort_values(
        ["specialness_score", "tup_count", "subject"], ascending=[False, False, True]
    ).reset_index(drop=True)
    score_df.insert(0, "rank", np.arange(1, len(score_df) + 1))
    score_df["special_threshold_flag"] = score_df["specialness_score"] >= 2.0
    return score_df, global_mean, global_std


def choose_global_val_subjects(global_pool: pd.DataFrame, n_val_subjects: int = 2):
    subjects = sorted(global_pool["subject"].unique().tolist())
    if len(subjects) <= n_val_subjects:
        return subjects, []

    total_counts = global_pool["upperbody_label"].value_counts().reindex(LABELS, fill_value=0)
    total_ratio = total_counts / max(1, len(global_pool))
    target_row_ratio = n_val_subjects / len(subjects)

    best_combo = None
    best_cost = None

    for combo in combinations(subjects, n_val_subjects):
        val_df = global_pool[global_pool["subject"].isin(combo)]
        train_df = global_pool[~global_pool["subject"].isin(combo)]
        val_counts = val_df["upperbody_label"].value_counts().reindex(LABELS, fill_value=0)
        val_ratio = val_counts / max(1, len(val_df))
        row_ratio = len(val_df) / max(1, len(global_pool))
        label_cost = float(np.abs(val_ratio - total_ratio).sum())
        size_cost = abs(row_ratio - target_row_ratio)
        subject_cost = 0.0
        score = label_cost * 10.0 + size_cost * 4.0 + subject_cost
        if best_cost is None or score < best_cost:
            best_cost = score
            best_combo = combo

    val_subjects = list(best_combo)
    train_subjects = [s for s in subjects if s not in val_subjects]
    return train_subjects, val_subjects


def choose_personal_calibration(subj_df: pd.DataFrame, subject_id: int, seed: int = 42):
    tup_rows = subj_df[subj_df["upperbody_label"] == "TUP"].copy()
    if tup_rows.empty:
        raise ValueError(f"Subject {subject_id} has no TUP samples for calibration.")

    calib_count = int(round(len(tup_rows) * 0.18))
    calib_count = max(12, calib_count)
    calib_count = min(25, calib_count)
    calib_count = min(calib_count, len(tup_rows))
    if calib_count <= 0:
        calib_count = max(1, len(tup_rows) // 2)

    calib_rows = tup_rows.sample(n=calib_count, random_state=seed + int(subject_id)).copy()
    eval_rows = subj_df.drop(index=calib_rows.index).copy()
    return calib_rows, eval_rows


def render_ranking(score_df: pd.DataFrame, output_path: Path):
    fig, ax = plt.subplots(figsize=(12, 6))
    colors = ["#ef4444" if flag else "#38bdf8" for flag in score_df["special_threshold_flag"]]
    bars = ax.bar(score_df["subject"].astype(str), score_df["specialness_score"], color=colors, edgecolor="white", linewidth=1.0)
    for bar, score in zip(bars, score_df["specialness_score"]):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.05, f"{score:.2f}", ha="center", va="bottom", fontsize=10)
    ax.axhline(2.0, linestyle="--", linewidth=1.2, color="#f59e0b", label="特殊度阈值 2.0")
    ax.set_title("subject 体型特殊度排名", fontsize=15, fontweight="bold")
    ax.set_xlabel("subject")
    ax.set_ylabel("specialness score")
    ax.grid(axis="y", alpha=0.25)
    ax.legend(frameon=False, fontsize=10)
    plt.tight_layout()
    plt.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)


def render_split_overview(split_df: pd.DataFrame, output_path: Path):
    counts = split_df["split_group"].value_counts().reindex(
        ["global_train", "global_val", "personal_calibration", "personal_eval"], fill_value=0
    )
    labels_cn = ["全局训练", "全局验证", "个性化标定", "个性化运行"]
    colors = ["#10b981", "#38bdf8", "#f59e0b", "#ef4444"]
    fig, ax = plt.subplots(figsize=(9, 5))
    bars = ax.bar(labels_cn, counts.values, color=colors, edgecolor="white", linewidth=1.0)
    for bar, value in zip(bars, counts.values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 10, str(int(value)), ha="center", va="bottom", fontsize=11)
    ax.set_title("数据划分概览", fontsize=15, fontweight="bold")
    ax.set_ylabel("样本数量")
    ax.grid(axis="y", alpha=0.25)
    plt.tight_layout()
    plt.savefig(output_path, dpi=160, bbox_inches="tight")
    plt.close(fig)


def main():
    configure_chinese_font()
    df = pd.read_csv(CSV_PATH)
    if "subject" not in df.columns:
        raise ValueError("data.csv missing required 'subject' column.")

    score_df, global_mean, global_std = compute_subject_specialness(df)
    available_subjects = set(df["subject"].dropna().astype(int).unique().tolist())
    special_subjects = FIXED_PERSONAL_TEST_SUBJECTS & available_subjects
    if len(special_subjects) != len(FIXED_PERSONAL_TEST_SUBJECTS):
        missing = sorted(FIXED_PERSONAL_TEST_SUBJECTS - special_subjects)
        raise ValueError(f"Fixed personal test subjects not found in data.csv: {missing}")
    global_pool_df = df[~df["subject"].isin(special_subjects)].copy().reset_index(drop=True)
    global_train_subjects, global_val_subjects = choose_global_val_subjects(global_pool_df, n_val_subjects=2)
    global_train_subjects = set(global_train_subjects)
    global_val_subjects = set(global_val_subjects)

    row_split_rows = []
    personal_rows = []

    for subject in df["subject"].drop_duplicates().tolist():
        subj_df = df[df["subject"] == subject].copy()
        if subject in special_subjects:
            calib_rows, eval_rows = choose_personal_calibration(subj_df, subject)
            personal_rows.append({
                "subject": subject,
                "specialness_score": float(score_df.loc[score_df["subject"] == subject, "specialness_score"].iloc[0]),
                "calibration_count": int(len(calib_rows)),
                "evaluation_count": int(len(eval_rows)),
                "calibration_ratio": round(safe_div(len(calib_rows), len(subj_df)), 4),
            })
            for idx in calib_rows.index:
                row_split_rows.append({
                    "row_id": int(idx),
                    "subject": subject,
                    "upperbody_label": df.loc[idx, "upperbody_label"],
                    "split_group": "personal_calibration",
                })
            for idx in eval_rows.index:
                row_split_rows.append({
                    "row_id": int(idx),
                    "subject": subject,
                    "upperbody_label": df.loc[idx, "upperbody_label"],
                    "split_group": "personal_eval",
                })
        elif subject in global_val_subjects:
            for idx in subj_df.index:
                row_split_rows.append({
                    "row_id": int(idx),
                    "subject": subject,
                    "upperbody_label": df.loc[idx, "upperbody_label"],
                    "split_group": "global_val",
                })
        elif subject in global_train_subjects:
            for idx in subj_df.index:
                row_split_rows.append({
                    "row_id": int(idx),
                    "subject": subject,
                    "upperbody_label": df.loc[idx, "upperbody_label"],
                    "split_group": "global_train",
                })
        else:
            # 兜底：理论上不会发生
            for idx in subj_df.index:
                row_split_rows.append({
                    "row_id": int(idx),
                    "subject": subject,
                    "upperbody_label": df.loc[idx, "upperbody_label"],
                    "split_group": "unassigned",
                })

    split_df = pd.DataFrame(row_split_rows).sort_values("row_id").reset_index(drop=True)
    overlap = split_df.groupby("row_id")["split_group"].nunique()
    if (overlap > 1).any():
        raise ValueError("Row leakage detected in split planning.")

    subject_split_rows = []
    for _, row in score_df.iterrows():
        subject = row["subject"]
        if subject in special_subjects:
            role = "personal_test"
        elif subject in global_val_subjects:
            role = "global_val"
        else:
            role = "global_train"
        subject_split_rows.append({
            "subject": subject,
            "specialness_rank": int(row["rank"]),
            "specialness_score": float(row["specialness_score"]),
            "split_role": role,
            "is_special_test_subject": subject in special_subjects,
            "special_threshold_flag": bool(row["special_threshold_flag"]),
        })

    subject_split_df = pd.DataFrame(subject_split_rows)

    score_df.to_csv(OUTPUT_SUBJECT_SCORE, index=False, encoding="utf-8-sig")
    subject_split_df.to_csv(OUTPUT_SUBJECT_SPLIT, index=False, encoding="utf-8-sig")
    split_df.to_csv(OUTPUT_ROW_SPLIT, index=False, encoding="utf-8-sig")

    render_ranking(score_df, OUTPUT_RANKING_IMG)
    render_split_overview(split_df, OUTPUT_SPLIT_IMG)

    global_train_rows = int((split_df["split_group"] == "global_train").sum())
    global_val_rows = int((split_df["split_group"] == "global_val").sum())
    personal_calib_rows = int((split_df["split_group"] == "personal_calibration").sum())
    personal_eval_rows = int((split_df["split_group"] == "personal_eval").sum())

    report_lines = [
        "# 数据集划分与特殊度分析报告",
        "",
        "> 本报告用于后续 KAN + SVM 实验的第一步：数据集处理、特殊度排名与无泄露划分。",
        "",
        "---",
        "",
        "## 1. 数据概况",
        "",
        f"- **样本总数**：{len(df)} 条",
        f"- **subject 数量**：{df['subject'].nunique()} 个",
        f"- **类别数**：5 类上半身体态",
        f"- **评估依据**：仅使用 `TUP`（端正坐姿）样本建立个体中立基线",
        "",
        "### 类别分布",
        "",
        "| 标签 | 含义 | 样本数 | 占比 |",
        "|:----:|:----:|:------:|:----:|",
    ]

    label_counts = df["upperbody_label"].value_counts().reindex(LABELS, fill_value=0)
    for label in LABELS:
        report_lines.append(
            f"| {label} | {LABEL_CN[label]} | {int(label_counts[label])} | {label_counts[label] / len(df) * 100:.1f}% |"
        )

    report_lines += [
        "",
        f"![subject 特殊度排名]({OUTPUT_RANKING_IMG})",
        "",
        "## 2. 特殊度定义",
        "",
        "我们只使用每个 subject 的 `TUP` 样本计算中立校准基线，并与全体 TUP 分布比较：",
        "",
        "```",
        "score = sqrt(z_neck_angle^2 + z_head_depth_delta^2 + z_depth_delta^2 + z_torso_tilt^2 + z_shoulder_diff^2 + z_shoulder_width^2)",
        "```",
        "",
        "- `score >= 2.0`：可视为体型/机位偏离较明显",
        "- 特殊度排名仅用于分析 subject 差异，不参与最终测试集选择",
        f"- 最终新用户测试 subject 固定为：{', '.join(map(str, sorted(special_subjects)))}",
        "",
        "## 3. subject 特殊度排名",
        "",
        "| 排名 | subject | 特殊度分数 | TUP 样本数 | 总样本数 | 阈值标记 |",
        "|:----:|:-------:|:----------:|:---------:|:--------:|:--------:|",
    ]

    for _, row in score_df.iterrows():
        report_lines.append(
            f"| {int(row['rank'])} | {int(row['subject'])} | {row['specialness_score']:.4f} | "
            f"{int(row['tup_count'])} | {int(row['total_count'])} | "
            f"{'YES' if row['special_threshold_flag'] else 'NO'} |"
        )

    report_lines += [
        "",
        "## 4. 数据划分方案",
        "",
        f"- **全局模型训练集**：8 个 subject",
        f"- **全局模型验证集**：2 个 subject",
        f"- **个性化新用户测试集**：{len(special_subjects)} 个 subject",
        f"- **个性化标定样本**：每个新用户仅从其 `TUP` 样本中抽取 12-25 条",
        "",
        "| 划分 | 样本数 | 说明 |",
        "|:----:|:------:|:----:|",
        f"| 全局训练 | {global_train_rows} | KAN 全局模型训练 |",
        f"| 全局验证 | {global_val_rows} | KAN 调参验证 |",
        f"| 个性化标定 | {personal_calib_rows} | 新用户中立校准 |",
        f"| 个性化运行 | {personal_eval_rows} | 新用户最终评估 |",
        "",
        f"![数据划分概览]({OUTPUT_SPLIT_IMG})",
        "",
        "### 4.1 subject 分配",
        "",
        "| subject | 特殊度分数 | 划分角色 |",
        "|:------:|:----------:|:--------:|",
    ]

    for _, row in subject_split_df.sort_values("specialness_score", ascending=False).iterrows():
        report_lines.append(
            f"| {int(row['subject'])} | {row['specialness_score']:.4f} | {row['split_role']} |"
        )

    report_lines += [
        "",
        "### 4.2 无数据泄露说明",
        "",
        "- `subject` 级别划分，保证同一 subject 不会同时出现在全局训练和验证中",
        f"- 新用户测试 subject {', '.join(map(str, sorted(special_subjects)))} 与全局模型训练/验证 subject 完全不重叠",
        "- 每个新用户的标定样本只来自该用户自身的 `TUP` 样本，不参与最终评估",
        "- `row_split_plan.csv` 已输出到本地，可直接用于后续训练脚本读取",
        "",
        "## 5. 输出文件",
        "",
        f"| 文件 | 说明 |",
        f"|:----:|:----:|",
        f"| `{OUTPUT_SUBJECT_SCORE}` | subject 特殊度排名与特征统计 |",
        f"| `{OUTPUT_SUBJECT_SPLIT}` | subject 级别划分方案 |",
        f"| `{OUTPUT_ROW_SPLIT}` | 行级别样本划分方案 |",
        f"| `{OUTPUT_RANKING_IMG}` | subject 特殊度排名图 |",
        f"| `{OUTPUT_SPLIT_IMG}` | 数据划分概览图 |",
        "",
    ]

    if personal_rows:
        report_lines += [
            "## 6. 个性化新用户标定明细",
            "",
            "| subject | 特殊度分数 | 标定样本数 | 运行样本数 | 标定比例 |",
            "|:------:|:----------:|:---------:|:---------:|:-------:|",
        ]
        for item in personal_rows:
            report_lines.append(
                f"| {item['subject']} | {item['specialness_score']:.4f} | "
                f"{item['calibration_count']} | {item['evaluation_count']} | {item['calibration_ratio']*100:.1f}% |"
            )

    with open(OUTPUT_REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines))

    print(f"Subject specialness ranking saved to: {OUTPUT_SUBJECT_SCORE}")
    print(f"Subject split plan saved to:          {OUTPUT_SUBJECT_SPLIT}")
    print(f"Row split plan saved to:              {OUTPUT_ROW_SPLIT}")
    print(f"Report saved to:                      {OUTPUT_REPORT}")
    print(f"Personal test subjects:               {sorted(special_subjects)}")


if __name__ == "__main__":
    main()
