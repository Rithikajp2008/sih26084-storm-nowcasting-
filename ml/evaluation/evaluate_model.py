import argparse
import pandas as pd
import numpy as np
import joblib
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score, brier_score_loss, confusion_matrix
from ml.features.build_features import build_features

def evaluate(data_path: str, model_path: str):
    df = pd.read_csv(data_path)
    if 'target' not in df:
        print("MODEL TRAINING DATASET NOT CONFIGURED: 'target' column required for evaluation.")
        return

    features_df = build_features(df)
    y = features_df.pop('target').astype(int)
    X = features_df.select_dtypes('number').fillna(0)

    bundle = joblib.load(model_path)
    m = bundle['model']
    
    # align features
    if 'features' in bundle:
        expected_cols = bundle['features']
        for col in expected_cols:
            if col not in X:
                X[col] = 0.0
        X = X[expected_cols]

    probs = m.predict_proba(X)[:, 1]
    pred = (probs >= 0.5).astype(int)

    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    
    # Official Meteorological Verification Metrics (WMO / MoES)
    pod = tp / (tp + fn) if (tp + fn) > 0 else 0.0  # Probability of Detection (Hit Rate)
    far = fp / (tp + fp) if (tp + fp) > 0 else 0.0  # False Alarm Ratio
    csi = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0.0  # Critical Success Index (Threat Score)
    
    pr, re, f1, _ = precision_recall_fscore_support(y, pred, average='binary', zero_division=0)
    roc = roc_auc_score(y, probs) if len(np.unique(y)) > 1 else None
    brier = brier_score_loss(y, probs)

    results = {
        "meteorological_metrics": {
            "CSI (Critical Success Index)": round(csi, 4),
            "POD (Probability of Detection)": round(pod, 4),
            "FAR (False Alarm Ratio)": round(far, 4),
        },
        "ml_classification_metrics": {
            "Precision": round(pr, 4),
            "Recall": round(re, 4),
            "F1-Score": round(f1, 4),
            "ROC-AUC": round(roc, 4) if roc else "N/A",
            "Brier Score (Calibration)": round(brier, 4),
        },
        "contingency_table": {
            "Hits (TP)": int(tp),
            "False Alarms (FP)": int(fp),
            "Misses (FN)": int(fn),
            "Correct Negatives (TN)": int(tn),
        },
        "model_version": bundle.get('version', 'unknown')
    }

    print("=== METEOROLOGICAL & ML VERIFICATION REPORT ===")
    for category, metrics in results.items():
        if isinstance(metrics, dict):
            print(f"\n[{category.upper()}]")
            for k, v in metrics.items():
                print(f"  {k:35s}: {v}")
        else:
            print(f"\n{category}: {metrics}")
            
    return results

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--data', required=True)
    p.add_argument('--model', required=True)
    args = p.parse_args()
    evaluate(args.data, args.model)
