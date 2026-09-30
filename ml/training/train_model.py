import argparse,os,joblib,pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from ml.features.build_features import build_features

def main(path,out):
    df=build_features(pd.read_csv(path)); target='target'
    if target not in df: raise SystemExit('Dataset must contain target column (0/1). No synthetic labels are generated.')
    X=df.drop(columns=[target]); y=df[target].astype(int); X=X.select_dtypes('number').fillna(0)
    if y.nunique()<2: raise SystemExit('Need both target classes for training.')
    Xtr,Xte,ytr,yte=train_test_split(X,y,test_size=.2,random_state=42,stratify=y)
    m=HistGradientBoostingClassifier(max_iter=150,random_state=42);m.fit(Xtr,ytr);print(classification_report(yte,m.predict(Xte)))
    os.makedirs(os.path.dirname(out) or '.',exist_ok=True);joblib.dump({'model':m,'features':list(X.columns),'version':'trained-baseline-v1'},out)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--out',default='ml/artifacts/model.joblib');a=p.parse_args();main(a.data,a.out)
