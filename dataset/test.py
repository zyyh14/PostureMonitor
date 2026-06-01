import math
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Patch

CSV_PATH = Path(__file__).resolve().parent / "data.csv"
OVERVIEW_PATH = Path(__file__).resolve().parent / "posture_dataset_overview.png"
SAMPLES_PATH = Path(__file__).resolve().parent / "posture_pose_samples.png"

LABELS = ["TUP", "TLF", "TLB", "TLR", "TLL"]
LABEL_MAP = {
    "TUP": "端正坐姿",
    "TLB": "身体后仰 / 瘫坐",
    "TLF": "身体前倾 / 探颈",
    "TLR": "身体向右歪斜",
    "TLL": "身体向左歪斜",
}
COLOR_MAP = {
    "TUP": "#10b981",
    "TLF": "#f59e0b",
    "TLB": "#3b82f6",
    "TLR": "#8b5cf6",
    "TLL": "#ef4444",
}
JOINT_CN = {
    "nose": "鼻尖",
    "left_eye": "左眼",
    "right_eye": "右眼",
    "left_ear": "左耳",
    "right_ear": "右耳",
    "mouth_left": "左嘴角",
    "mouth_right": "右嘴角",
    "left_shoulder": "左肩",
    "right_shoulder": "右肩",
    "left_hip": "左髋",
    "right_hip": "右髋",
}

SKELETON_EDGES = [
    ("nose", "left_eye"), ("nose", "right_eye"),
    ("left_eye", "left_ear"), ("right_eye", "right_ear"),
    ("left_eye", "mouth_left"), ("right_eye", "mouth_right"),
    ("mouth_left", "mouth_right"),
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("nose", "left_shoulder"), ("nose", "right_shoulder"),
]


def configure_chinese_font():
    candidates = ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "Arial Unicode MS"]
    available = {f.name for f in font_manager.fontManager.ttflist}
    for font_name in candidates:
        if font_name in available:
            plt.rcParams["font.sans-serif"] = [font_name]
            break
    plt.rcParams["axes.unicode_minus"] = False


def get_point(row, joint):
    return row[f"{joint}_x"], row[f"{joint}_y"], row[f"{joint}_z"]


def extract_features_row(row):
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
    depth_delta = mid_sh_z - mid_hip_z
    return {"neck_angle": neck_angle, "torso_tilt": torso_tilt, "depth_delta": depth_delta}


def get_median_sample(sub_df):
    feats = sub_df.apply(extract_features_row, axis=1, result_type="expand")
    median_neck = feats["neck_angle"].median()
    median_tilt = feats["torso_tilt"].median()
    median_depth = feats["depth_delta"].median()
    dist = (
        (feats["neck_angle"] - median_neck).abs()
        + (feats["torso_tilt"] - median_tilt).abs()
        + (feats["depth_delta"] - median_depth).abs()
    )
    return sub_df.iloc[int(dist.argmin())]


def plot_class_distribution(ax, df):
    counts = df["upperbody_label"].value_counts().reindex(LABELS)
    bars = ax.bar(
        [f"{l}\n{LABEL_MAP[l]}" for l in LABELS],
        counts.values,
        color=[COLOR_MAP[l] for l in LABELS],
        edgecolor="white",
        linewidth=1.2,
    )
    for bar, val in zip(bars, counts.values):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 15, str(val),
                ha="center", va="bottom", fontsize=10, fontweight="bold")
    ax.set_title("类别分布", fontsize=14, fontweight="bold")
    ax.set_ylabel("样本数量", fontsize=10)
    ax.set_ylim(0, counts.max() * 1.18)
    ax.grid(axis="y", alpha=0.25)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


def plot_feature_boxplots(axes, df):
    feat_df = df.apply(extract_features_row, axis=1, result_type="expand")
    feat_df["label"] = df["upperbody_label"].values
    feature_defs = [
        ("neck_angle", "颈部偏角 (°)"),
        ("torso_tilt", "躯干侧倾角 (°)"),
        ("depth_delta", "肩髋深度差 (Z)"),
    ]
    for ax, (col, title) in zip(axes, feature_defs):
        data = [feat_df[feat_df["label"] == l][col].values for l in LABELS]
        bp = ax.boxplot(
            data,
            patch_artist=True,
            medianprops=dict(color="white", linewidth=2),
            whiskerprops=dict(linewidth=1.2),
            capprops=dict(linewidth=1.2),
            flierprops=dict(marker="o", markersize=2, alpha=0.3),
        )
        for patch, label in zip(bp["boxes"], LABELS):
            patch.set_facecolor(COLOR_MAP[label])
            patch.set_alpha(0.8)
        ax.set_xticks(range(1, len(LABELS) + 1))
        ax.set_xticklabels(LABELS, fontsize=9)
        ax.set_title(title, fontsize=12, fontweight="bold")
        ax.grid(axis="y", alpha=0.25)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)


def draw_skeleton(ax, row, label, mode="front"):
    points = {joint: get_point(row, joint) for joint in JOINT_CN}
    color = COLOR_MAP[label]
    if mode == "front":
        xs = [points[j][0] for j in JOINT_CN]
        ys = [points[j][1] for j in JOINT_CN]
        ax.scatter(xs, ys, s=42, color=color, alpha=0.95, zorder=3)
        for a, b in SKELETON_EDGES:
            xa, ya, _ = points[a]
            xb, yb, _ = points[b]
            ax.plot([xa, xb], [ya, yb], color=color, linewidth=2.2)
        for joint in ["nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip"]:
            x, y, _ = points[joint]
            ax.text(x + 0.01, y, JOINT_CN[joint], fontsize=8, color="#111827", fontweight="bold")
        ax.set_xlabel("X（左右）", fontsize=9)
        ax.set_ylabel("Y（上下）", fontsize=9)
        ax.invert_yaxis()
    else:
        xs = [points[j][0] for j in JOINT_CN]
        zs = [points[j][2] for j in JOINT_CN]
        ax.scatter(xs, zs, s=42, color=color, alpha=0.95, zorder=3)
        depth_edges = [
            ("nose", "left_shoulder"), ("nose", "right_shoulder"),
            ("left_shoulder", "right_shoulder"),
            ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
            ("left_hip", "right_hip"),
        ]
        for a, b in depth_edges:
            xa, _, za = points[a]
            xb, _, zb = points[b]
            ax.plot([xa, xb], [za, zb], color=color, linewidth=2.2)
        for joint in ["nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip"]:
            x, _, z = points[joint]
            ax.text(x + 0.01, z, JOINT_CN[joint], fontsize=8, color="#111827", fontweight="bold")
        ax.set_xlabel("X（左右）", fontsize=9)
        ax.set_ylabel("Z（前后深度）", fontsize=9)
        ax.invert_yaxis()

    ax.set_title(f"{label}  {LABEL_MAP[label]}{' · 深度视图' if mode == 'depth' else ''}",
                 fontsize=12, fontweight="bold", color=color)
    ax.set_aspect("equal", adjustable="box")
    ax.grid(True, alpha=0.2)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


def main():
    configure_chinese_font()
    df = pd.read_csv(CSV_PATH)

    # 图 1：数据概览
    fig1, axes = plt.subplots(1, 4, figsize=(18, 5))
    fig1.suptitle("MultiPosture 数据集概览", fontsize=18, fontweight="bold", y=1.02)
    plot_class_distribution(axes[0], df)
    plot_feature_boxplots(axes[1:], df)
    plt.tight_layout()
    plt.savefig(OVERVIEW_PATH, dpi=160, bbox_inches="tight")
    plt.close(fig1)

    # 图 2：每类代表样本
    fig2, axes2 = plt.subplots(len(LABELS), 2, figsize=(14, 24))
    fig2.suptitle("五类体态代表样本骨架图", fontsize=18, fontweight="bold", y=0.995)
    legend_handles = [Patch(color=COLOR_MAP[k], label=f"{k} — {LABEL_MAP[k]}") for k in LABELS]
    for idx, label in enumerate(LABELS):
        sub = df[df["upperbody_label"] == label]
        sample = get_median_sample(sub)
        draw_skeleton(axes2[idx, 0], sample, label, mode="front")
        draw_skeleton(axes2[idx, 1], sample, label, mode="depth")
    fig2.legend(handles=legend_handles, loc="upper center", bbox_to_anchor=(0.5, 0.985),
                ncol=5, frameon=False, fontsize=10)
    plt.tight_layout(rect=[0, 0, 1, 0.98])
    plt.savefig(SAMPLES_PATH, dpi=160, bbox_inches="tight")
    plt.close(fig2)

    print(f"Saved overview to: {OVERVIEW_PATH}")
    print(f"Saved samples to: {SAMPLES_PATH}")


if __name__ == "__main__":
    main()
