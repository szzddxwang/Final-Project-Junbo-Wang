"""Fair grouped ADC ablations, calibration, and held-out-fault OOD research."""

import csv
import json
from pathlib import Path

import joblib
import numpy as np
from scipy.optimize import minimize_scalar
from scipy.special import softmax
from sklearn.covariance import LedoitWolf
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ..physics_features import adc_physics
from .training import make_model


def structured_features(samples: np.ndarray) -> np.ndarray:
    """Observable summary statistics from commanded, pin, and decoded signals."""
    x = np.asarray(samples, dtype=float)
    commanded, pin, decoded = x * 3.3
    delta = pin - commanded
    centered = pin - pin.mean()
    psd = abs(np.fft.rfft(centered)) ** 2
    return np.asarray([
        np.mean(commanded), np.std(commanded), np.ptp(commanded),
        np.mean(pin), np.std(pin), np.ptp(pin),
        np.mean(delta), np.std(delta), np.sqrt(np.mean(delta ** 2)),
        np.mean(decoded - pin), np.std(decoded - pin),
        np.mean(np.isclose(decoded, decoded.max(), atol=.002)),
        np.mean(pin >= 3.3), np.mean(pin <= 0),
        np.ptp(decoded) / max(np.ptp(commanded), .01),
        float(np.argmax(psd[1:]) + 1) if len(psd) > 1 else 0,
    ], dtype=float)


PHYSICS_NAMES = (
    "count_intended_residual", "path_voltage_difference",
    "intended_saturation_indicator",
)


def physics_features(metadata: dict, samples: np.ndarray) -> np.ndarray:
    """Derive only what a learner could compute from the supplied traces/spec.

    Simulator actual Vref, actual bit depth and fault identity are deliberately
    excluded. A separate measured Vref may be supplied at inference time, but
    this research model does not rely on it.
    """
    operating = metadata["operating_point"]
    commanded, pin, reconstructed = (float(samples[i, 0] * 3.3) for i in range(3))
    target_ref = float(operating["vref_target_v"])
    target_bits = int(operating["resolution_target_bits"])
    count = int(np.clip(round(reconstructed / target_ref * (1 << target_bits)),
                        0, (1 << target_bits) - 1))
    values = {
        "OUTPUT_VOLTAGE": commanded,
        "ADC_INPUT_VOLTAGE": pin,
        "ADC_REFERENCE_TARGET": target_ref,
        "ADC_INTENDED_BITS": target_bits,
        "ADC_READING": count,
    }
    features = adc_physics(values)
    if any(features[name] is None for name in PHYSICS_NAMES):
        raise ValueError("Observable ADC physics evidence is incomplete")
    return np.asarray([float(features[name]) for name in PHYSICS_NAMES], dtype=float)


def _scores(y, probability, classes):
    predicted = np.argmax(probability, axis=1)
    return {
        "accuracy": float(accuracy_score(y, predicted)),
        "macro_f1": float(f1_score(y, predicted, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, predicted, average="weighted", zero_division=0)),
        "per_class_f1": {name: float(score) for name, score in zip(classes,
            f1_score(y, predicted, labels=np.arange(len(classes)), average=None, zero_division=0))},
    }


def _brier(y, probabilities):
    target = np.eye(probabilities.shape[1])[y]
    return float(np.mean(np.sum((probabilities - target) ** 2, axis=1)))


def _reliability(y, probabilities, bins=10):
    confidence = np.max(probabilities, axis=1)
    correct = np.argmax(probabilities, axis=1) == y
    rows, ece = [], 0.0
    for index in range(bins):
        lower, upper = index / bins, (index + 1) / bins
        mask = (confidence >= lower) & ((confidence <= upper) if index == bins-1 else (confidence < upper))
        if np.any(mask):
            accuracy, certainty = float(correct[mask].mean()), float(confidence[mask].mean())
            ece += float(mask.mean()) * abs(accuracy - certainty)
        else:
            accuracy = certainty = None
        rows.append({"lower": lower, "upper": upper, "count": int(mask.sum()),
                     "accuracy": accuracy, "confidence": certainty})
    return float(ece), rows


def calibration(val_truth, val_logits, test_truth, test_logits):
    def objective(temperature):
        prob = softmax(val_logits / temperature, axis=1)
        return float(-np.log(np.clip(prob[np.arange(len(val_truth)), val_truth], 1e-12, 1)).mean())
    fit = minimize_scalar(objective, bounds=(.25, 8), method="bounded")
    raw = softmax(test_logits, axis=1)
    scaled = softmax(test_logits / fit.x, axis=1)
    raw_ece, raw_bins = _reliability(test_truth, raw)
    scaled_ece, scaled_bins = _reliability(test_truth, scaled)
    return {"temperature": float(fit.x), "fitted_on": "grouped_validation",
            "evaluated_on": "grouped_test", "raw_brier": _brier(test_truth, raw),
            "calibrated_brier": _brier(test_truth, scaled),
            "raw_ece": raw_ece, "calibrated_ece": scaled_ece,
            "raw_reliability": raw_bins, "calibrated_reliability": scaled_bins}


def _cnn_predictions(model_path, x):
    import torch
    package = torch.load(model_path, map_location="cpu", weights_only=True)
    model = make_model(package["channels"], len(package["classes"]))
    model.load_state_dict(package["state_dict"])
    model.eval()
    with torch.no_grad():
        logits, embedding = model(torch.from_numpy(x), return_embedding=True)
    return logits.numpy(), embedding.numpy()


def ood_holdout(x, y, splits, classes, result: Path, seed=47):
    """Train a *new* CNN without SIGNAL_ATTENUATION, then score its embeddings."""
    import torch
    torch.manual_seed(seed + 19)
    torch.set_num_threads(2)
    held = classes.index("SIGNAL_ATTENUATION")
    known_classes = [name for name in classes if name != "SIGNAL_ATTENUATION"]
    mapping = {old: new for new, old in enumerate(i for i in range(len(classes)) if i != held)}
    train = splits["train"][y[splits["train"]] != held]
    val = splits["validation"][y[splits["validation"]] != held]
    test = splits["test"]
    target = np.asarray([mapping.get(int(v), -1) for v in y], dtype=int)
    model = make_model(x.shape[1], len(known_classes))
    optimizer = torch.optim.Adam(model.parameters(), lr=.003)
    criterion = torch.nn.CrossEntropyLoss()
    loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(
        torch.from_numpy(x[train]), torch.from_numpy(target[train])), batch_size=64, shuffle=True)
    best, best_state, patience = float("inf"), None, 0
    for _ in range(12):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad(); loss=criterion(model(xb), yb); loss.backward(); optimizer.step()
        model.eval()
        with torch.no_grad():
            loss = float(criterion(model(torch.from_numpy(x[val])), torch.from_numpy(target[val])).item())
        if loss < best - 1e-4:
            best, patience = loss, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 4: break
    model.load_state_dict(best_state); model.eval()
    with torch.no_grad():
        _, train_embedding = model(torch.from_numpy(x[train]), return_embedding=True)
        _, val_embedding = model(torch.from_numpy(x[val]), return_embedding=True)
        _, test_embedding = model(torch.from_numpy(x[test]), return_embedding=True)
    train_embedding=train_embedding.numpy(); val_embedding=val_embedding.numpy(); test_embedding=test_embedding.numpy()
    means=np.stack([train_embedding[target[train]==i].mean(axis=0) for i in range(len(known_classes))])
    centered=np.concatenate([train_embedding[target[train]==i]-means[i] for i in range(len(known_classes))])
    precision=LedoitWolf().fit(centered).precision_
    def distance(emb):
        delta=emb[:,None,:]-means[None,:,:]
        return np.min(np.einsum('ncd,df,ncf->nc',delta,precision,delta),axis=1)
    threshold=float(np.quantile(distance(val_embedding), .95))
    score=distance(test_embedding); unknown=(y[test]==held)
    result.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict":best_state,"channels":x.shape[1],"classes":known_classes,
                "excluded_fault":"SIGNAL_ATTENUATION"},result/"ood_cnn.pt")
    joblib.dump({"means":means,"precision":precision,"threshold":threshold,
                 "classes":known_classes,"excluded_fault":"SIGNAL_ATTENUATION"},result/"ood_detector.joblib")
    return {"method":"class_conditional_mahalanobis_cnn_embedding",
            "excluded_from_training":"SIGNAL_ATTENUATION", "threshold_source":"known_grouped_validation_95pct",
            "threshold":threshold,"auroc":float(roc_auc_score(unknown,score)),
            "known_acceptance_rate":float(np.mean(score[~unknown]<=threshold)),
            "unknown_detection_rate":float(np.mean(score[unknown]>threshold)),
            "false_unknown_rate":float(np.mean(score[~unknown]>threshold)),
            "known_test_cases":int((~unknown).sum()),"unknown_test_cases":int(unknown.sum()),
            "data_source":"PYTHON_SIMULATION"}


def run_research(root: Path, model_root: Path):
    from xgboost import XGBClassifier
    dataset=root/"datasets"/"adc_waveforms.npz"
    data=np.load(dataset,allow_pickle=False); x=data["x"]; y=data["y"]
    splits={name:data[f"split_{name}"] for name in ("train","validation","test")}
    manifest=json.loads(dataset.with_suffix(".manifest.json").read_text(encoding="utf-8"))
    metadata=[json.loads(line) for line in dataset.with_suffix(".jsonl").read_text(encoding="utf-8").splitlines()]
    structured=np.stack([structured_features(sample) for sample in x])
    physics=np.stack([physics_features(meta,sample) for meta,sample in zip(metadata,x)])
    classes=manifest["classes"]
    classifier=XGBClassifier(n_estimators=160,max_depth=4,learning_rate=.07,
        subsample=.85,colsample_bytree=.9,tree_method="hist",n_jobs=2,
        objective="multi:softprob",random_state=47)
    classifier.fit(structured[splits["train"]],y[splits["train"]])
    val,test=splits["validation"],splits["test"]
    structured_val=classifier.predict_proba(structured[val]); structured_test=classifier.predict_proba(structured[test])
    val_prediction=np.load(model_root/"waveform"/"adc"/"validation_predictions.npz")
    test_prediction=np.load(model_root/"waveform"/"adc"/"test_predictions.npz")
    assert np.array_equal(val,val_prediction["indices"]) and np.array_equal(test,test_prediction["indices"])
    waveform_val=softmax(val_prediction["logits"],axis=1)
    waveform_test=softmax(test_prediction["logits"],axis=1)
    input_sw_val=np.column_stack((structured_val,waveform_val))
    input_sw_test=np.column_stack((structured_test,waveform_test))
    input_swp_val=np.column_stack((structured_val,waveform_val,physics[val]))
    input_swp_test=np.column_stack((structured_test,waveform_test,physics[test]))
    fusion_sw=make_pipeline(StandardScaler(),LogisticRegression(max_iter=1000,C=.3))
    fusion_swp=make_pipeline(StandardScaler(),LogisticRegression(max_iter=1000,C=.3))
    fusion_sw.fit(input_sw_val,y[val]); fusion_swp.fit(input_swp_val,y[val])
    rows=[]
    for name,prob in (("experimental_structured_xgboost",structured_test),
                      ("waveform_cnn",waveform_test),
                      ("structured_plus_waveform",fusion_sw.predict_proba(input_sw_test)),
                      ("structured_plus_waveform_plus_physics",fusion_swp.predict_proba(input_swp_test))):
        rows.append({"model":name,"split":"same_grouped_adc_test","cases":len(test),
                     **_scores(y[test],prob,classes)})
    with (root/"fusion_ablation.csv").open("w",newline="",encoding="utf-8") as file:
        writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader()
        for row in rows: writer.writerow({**row,"per_class_f1":json.dumps(row["per_class_f1"])})
    joblib.dump({"structured":classifier,"fusion_sw":fusion_sw,"fusion_swp":fusion_swp,
                 "classes":classes,"physics_names":PHYSICS_NAMES,
                 "dataset_sha256":manifest["sha256"]},model_root/"waveform"/"adc"/"fusion.joblib")
    uncertainty=calibration(y[val],val_prediction["logits"],y[test],test_prediction["logits"])
    (root/"uncertainty_metrics.json").write_text(json.dumps(uncertainty,indent=2),encoding="utf-8")
    ood=ood_holdout(x,y,splits,classes,model_root/"waveform"/"adc"/"ood")
    (root/"ood_metrics.json").write_text(json.dumps(ood,indent=2),encoding="utf-8")
    return rows,uncertainty,ood
