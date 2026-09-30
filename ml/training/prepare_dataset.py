"""Convert supplied historical observations to the common training CSV schema.
This script deliberately does not invent labels; labels must come from verified historical events/targets."""
import argparse,pandas as pd
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args();df=pd.read_csv(a.input);df.to_csv(a.output,index=False);print('Prepared',len(df),'rows')
