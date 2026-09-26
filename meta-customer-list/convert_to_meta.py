import re, datetime, pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
import sys
SRC=sys.argv[1]  # centre database .xlsx (one tab per centre)
OUT=sys.argv[2] if len(sys.argv)>2 else 'DATABASE_META_UPLOAD.xlsx'
TODAY=datetime.date.today()
EMRE=re.compile(r'^[\w.+\-]+@[\w\-]+(\.[\w\-]+)+$')
def s(x): return '' if pd.isna(x) else str(x).strip()
def email(x):
    x=s(x).lower().replace(' ','');  return x if EMRE.match(x) else ''
def phone(x):
    d=re.sub(r'\D','',s(x).split('/')[0])
    if d.startswith('60'): d=d[2:]
    d=d.lstrip('0');  return '+60'+d if 8<=len(d)<=10 else ''
SEP={'BIN','BINTI','BT','BTE','B','BINTE','A/L','A/P','AL','AP'}
def split(n):
    n=re.sub(r'\s+',' ',s(n).split('@')[0]).strip()
    if not n: return '',''
    w=n.split(' ')
    for i,t in enumerate(w):
        if t.upper().rstrip('.') in SEP and 0<i<len(w)-1:
            return ' '.join(w[:i]).title(),' '.join(w[i+1:]).title()
    return (w[0].title(),' '.join(w[1:]).title()) if len(w)>1 else (w[0].title(),'')
def ic(x):
    d=re.sub(r'\D','',s(x))
    if len(d)!=12: return None
    yy,mm,dd=int(d[:2]),int(d[2:4]),int(d[4:6])
    y=2000+yy if yy<=TODAY.year%100-10 else 1900+yy
    try: b=datetime.date(y,mm,dd)
    except ValueError: return None
    age=TODAY.year-b.year-((TODAY.month,TODAY.day)<(b.month,b.day))
    if not 16<=age<=85: return None
    return b,age,'m' if int(d[-1])%2 else 'f'
STATES=[(1,2,'Perlis'),(5,9,'Kedah'),(10,14,'Pulau Pinang'),(15,18,'Kelantan'),(20,24,'Terengganu'),
 (25,28,'Pahang'),(30,36,'Perak'),(39,39,'Pahang'),(40,48,'Selangor'),(49,49,'Pahang'),(50,60,'Kuala Lumpur'),
 (62,62,'Putrajaya'),(63,64,'Selangor'),(68,68,'Selangor'),(69,69,'Pahang'),(70,73,'Negeri Sembilan'),
 (75,78,'Melaka'),(79,86,'Johor'),(87,87,'Labuan'),(88,91,'Sabah'),(93,98,'Sarawak')]
STWORDS=r'\b(selangor|kuala lumpur|wilayah persekutuan|w\.?\s?p\.?|kl|negeri sembilan|johor|melaka|perak|pahang|kedah|putrajaya|kelantan|terengganu|darul ehsan|malaysia)\b'
def addr(a):
    a=s(a); m=None
    for m in re.finditer(r'(?<!\d)(\d{5})(?!\d)',a): pass
    if not m: return '','',''
    z=m.group(1); p=int(z[:2]); st=next((n for lo,hi,n in STATES if lo<=p<=hi),'')
    if st in ('Kuala Lumpur','Putrajaya','Labuan'): return z,st,st
    ct=re.split(r'[,.]',a[m.end():].strip(' ,.'))[0]
    ct=re.sub(STWORDS,'',ct,flags=re.I); ct=re.sub(r'\s+',' ',ct).strip(' ,.-')
    FIX={'Jphor':'','Badnar Baru Bangi':'Bandar Baru Bangi','Sha Alam':'Shah Alam','Shsh Alam':'Shah Alam',
         'Seksyen 8 Shah Alam':'Shah Alam','Sg Buloh':'Sungai Buloh','Batu Caves Gombak':'Batu Caves',
         'Kg Jawa Klang':'Klang','Jalan Besar Sungai Tua Tanah Gantian':''}
    ct=ct.title(); ct=FIX.get(ct,ct)
    return z,ct,st
def col(df,*keys):
    for c in df.columns:
        if c.strip().lower() in keys: return df[c]
    return pd.Series(['']*len(df),index=df.index)
HDR=['email','email','email','phone','phone','phone','madid','fn','ln','zip','ct','st','country','dob','doby','gen','age','uid','value']
wb=Workbook(); wb.remove(wb.active); summary=[]
for name,df in pd.read_excel(SRC,sheet_name=None,dtype=str).items():
    df=df.dropna(how='all'); c=df.columns
    fa=col(df,"father's/guardian's name","father's name"); mo=col(df,"mother's name"); gu=col(df,'name (guardian)','emergency contact')
    fic=col(df,'mykad','i/c no'); mic=col(df,'mykad.1','i/c no.1'); gic=col(df,'mykad.2')
    ad=col(df,'address'); pr=col(df,'primary phone'); gp=col(df,'phone')
    rows=[]
    for i in df.index:
        r=df.loc[i]; ems=[email(r[c[k]]) for k in range(3)]
        e=list(dict.fromkeys(x for x in ems if x))[:3]
        pf,pm,pp=phone(r[c[3]]),phone(r[c[4]]),phone(pr[i])
        p=list(dict.fromkeys(x for x in [pf,pm,pp,phone(gp[i])] if x))[:3]
        if not e and not p: continue
        pe=ems[0]
        if pe and pe==ems[2] and pe!=ems[1] and s(mo[i]): who='m'
        elif pe and pe==ems[1] and s(fa[i]): who='f'
        elif not pe and pp and pp==pm and s(mo[i]): who='m'
        else: who='f' if s(fa[i]) else 'm' if s(mo[i]) else 'g'
        nm,icv={'f':(fa[i],fic[i]),'m':(mo[i],mic[i]),'g':(gu[i],gic[i])}[who]
        fn,ln=split(nm); info=ic(icv)
        dob,doby,age='','',''
        gen={'f':'m','m':'f'}.get(who,'') if s(nm) else ''
        if info: dob,doby,age=info[0].isoformat(),str(info[0].year),str(info[1]); gen=info[2]
        z,ct,st=addr(ad[i])
        rows.append(tuple(e+['']*(3-len(e))+p+['']*(3-len(p))+['',fn,ln,z,ct,st,'MY',dob,doby,gen,age,'','']))
    rows=list(dict.fromkeys(rows))
    ws=wb.create_sheet(name.strip()[:31]); ws.append(HDR)
    for rr in rows: ws.append([v if v!='' else None for v in rr])
    for cell in ws[1]: cell.font=Font(name='Arial',bold=True,color='FFFFFF'); cell.fill=PatternFill('solid',fgColor='1877F2')
    for row in ws.iter_rows(min_row=2):
        for cell in row: cell.font=Font(name='Arial'); cell.number_format='@'
    for k,w in enumerate([30,30,30,15,15,15,8,20,22,8,20,16,9,12,7,6,6,6,7],1): ws.column_dimensions[get_column_letter(k)].width=w
    ws.freeze_panes='A2'
    summary.append((name.strip(),len(rows)))
wb.save(OUT); print(summary, sum(n for _,n in summary))
