import argparse,pandas as pd,joblib
from ml.features.build_features import build_features
p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--model',required=True);a=p.parse_args();df=build_features(pd.read_csv(a.data));b=joblib.load(a.model);X=df[b['features']].fillna(0);print(b['model'].predict_proba(X)[:,1])
