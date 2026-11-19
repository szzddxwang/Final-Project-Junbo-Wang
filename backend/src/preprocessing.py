"""Shared, missing-aware preprocessing for all classifiers."""

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .feature_engineering import COMMON_FEATURES, IMPROVED_FEATURES, NEXT_ROUND_OBSERVABLE_FEATURES

BASE_FEATURE_COLUMNS = COMMON_FEATURES + ["symptom_type"]
IMPROVED_NUMERIC_COLUMNS = COMMON_FEATURES + IMPROVED_FEATURES
IMPROVED_FEATURE_COLUMNS = IMPROVED_NUMERIC_COLUMNS + ["symptom_type"]
FEATURE_COLUMNS = IMPROVED_FEATURE_COLUMNS
NEXT_ROUND_FEATURE_COLUMNS = IMPROVED_NUMERIC_COLUMNS + NEXT_ROUND_OBSERVABLE_FEATURES + ["symptom_type", "system_type"]


def model_frame(rows: pd.DataFrame, columns: list[str] | None = None) -> pd.DataFrame:
    selected = columns or FEATURE_COLUMNS
    frame = rows.reindex(columns=selected).copy()
    for code in selected:
        if code in {"symptom_type", "system_type"}:
            continue
        frame[code] = pd.to_numeric(frame[code], errors="coerce")
    if "symptom_type" in frame:
        frame["symptom_type"] = frame["symptom_type"].fillna("OTHER").astype(str)
    if "system_type" in frame:
        frame["system_type"] = frame["system_type"].fillna("UNKNOWN").astype(str)
    return frame


def make_preprocessor(columns: list[str] | None = None) -> ColumnTransformer:
    selected = columns or FEATURE_COLUMNS
    numeric_columns = [code for code in selected if code not in {"symptom_type", "system_type"}]
    numeric = Pipeline([
        ("impute", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)),
        ("scale", StandardScaler()),
    ])
    transformers = [("numeric", numeric, numeric_columns)]
    for code in ("symptom_type", "system_type"):
        if code in selected:
            transformers.append((code, OneHotEncoder(handle_unknown="ignore", sparse_output=False), [code]))
    return ColumnTransformer(transformers, sparse_threshold=0, verbose_feature_names_out=False)
