import re, datetime, pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
import sys, os, argparse
TODAY=datetime.date.today()
EMRE=re.compile(r'^[\w.+\-]+@[\w\-]+(\.[\w\-]+)+$')
def s(x):
    if x is None or (isinstance(x,float) and pd.isna(x)): return ''
    if isinstance(x,float) and x.is_integer(): x=int(x)  # numbers typed into Excel (IC, phone)
    return str(x).strip()
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
def name_gen(n):
    t={w.rstrip('.') for w in s(n).upper().split()}
    if t & {'BINTI','BT','BTE','BINTE','A/P'}: return 'f'
    if t & {'BIN','A/L'}: return 'm'
    return ''
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
    FIX={'Jphor':'','Badnar Baru Bangi':'Bandar Baru Bangi','Sha Alam':'Shah Alam','Shaha Alam':'Shah Alam','Cyber':'Cyberjaya','Paka Dungun':'Paka','Shsh Alam':'Shah Alam',
         'Seksyen 8 Shah Alam':'Shah Alam','Sg Buloh':'Sungai Buloh','Batu Caves Gombak':'Batu Caves',
         'Kg Jawa Klang':'Klang','Jalan Besar Sungai Tua Tanah Gantian':''}
    ct=ct.title(); ct=FIX.get(ct,ct)
    return z,ct,st
def col(df,*keys):
    for c in df.columns:
        if c.strip().lower() in keys: return df[c]
    return pd.Series(['']*len(df),index=df.index)
HDR=['email','email','email','phone','phone','phone','madid','fn','ln','zip','ct','st','country','dob','doby','gen','age','uid','value']
MAIN_COLS=['E-mail','E-mail Father','E-mail Mother','Phone Father','Phone Mother']

HEADS=('NAME','STUDENT NAME')

def header_map(h):
    """Column positions from a class-tab header row. Repeated PHONE NO / I/C NO / EMAIL columns are
    father's first, mother's second; a single EMAIL column is the family email."""
    if 'STUDENT NAME' in h:  # "Parents 1: Mobile | Parents 1: Name | Parents 1: IC No. | Parents 1: Email | Parents 2: ..."
        f=lambda lab: h.index(lab) if lab in h else None
        return dict(name=f('STUDENT NAME'),addr=f('ADDRESS'),roles=False,
                    fa=f('PARENTS 1: NAME'),fap=f('PARENTS 1: MOBILE'),faic=f('PARENTS 1: IC NO.'),fae=f('PARENTS 1: EMAIL'),
                    mo=f('PARENTS 2: NAME'),mop=f('PARENTS 2: MOBILE'),moic=f('PARENTS 2: IC NO.'),moe=f('PARENTS 2: EMAIL'))
    m={'name':h.index('NAME')}
    for k,lab in (('addr','ADDRESS'),('fa',"FATHER'S NAME"),('mo',"MOTHER'S NAME")):
        m[k]=h.index(lab) if lab in h else None
    ph=[i for i,x in enumerate(h) if x.startswith('PHONE')]; ic_=[i for i,x in enumerate(h) if x.startswith('I/C')]
    em=[i for i,x in enumerate(h) if x.startswith('EMAIL') or x.startswith('E-MAIL')]
    m.update(fap=ph[0] if ph else None, mop=ph[1] if len(ph)>1 else None,
             faic=ic_[0] if ic_ else None, moic=ic_[1] if len(ic_)>1 else None)
    if len(em)>1: m.update(fae=em[0],moe=em[1])
    elif em: m['fame']=em[0]
    return m

def owner(e,fa,mo):
    """'f' or 'm': which parent's name the email address resembles (default father)."""
    loc=re.sub(r'[^a-z]','',e.lower().split('@')[0])
    sc=lambda n: sum(len(w) for w in re.findall(r'[a-z]{4,}',s(n).lower()) if w not in ('binti','bin','mohd','muhammad','mohamad','mohammad','nurul','siti') and w in loc)
    return 'm' if sc(mo)>sc(fa) else 'f'

def read_sheets(path):
    """Yield (tab name, DataFrame) in the 'full database' column layout.

    Supports two layouts:
      * full database: one tab per centre, header in row 1 (E-mail, E-mail Father, E-mail Mother,
        Phone Father, Phone Mother, ... Father's Name, MyKad/I/C No, Mother's Name, ...)
      * 2024 class database: one tab per class, title block on top, then a header row
        NAME | MY KID NO | ADDRESS | FATHER'S NAME | EMAIL | PHONE NO | I/C NO | MOTHER'S NAME | PHONE NO | I/C NO | EMAIL
    """
    for name,raw in pd.read_excel(path,sheet_name=None,header=None,dtype=object).items():
        hi=next((i for i,r in raw.iterrows() if any(s(v).upper() in HEADS for v in r.iloc[:3])),None)
        if hi is None:  # full database layout
            df=pd.read_excel(path,sheet_name=name,dtype=object).dropna(how='all')
            yield name,df; continue
        recs=[]; m=None
        for _,r in raw.iloc[hi:].iterrows():
            vals=[s(v) for v in r]
            if any(v.upper() in HEADS for v in vals[:3]):  # (repeated) header row: map columns by name
                m=header_map([v.upper() for v in vals]); continue
            g=lambda k: vals[m[k]] if m.get(k) is not None and m[k]<len(vals) else ''
            v={k:g(k) for k in ('name','addr','fa','fae','fap','faic','mo','moe','mop','moic','fame')}
            if not any(v[k] for k in ('fa','fae','fap','mo','mop','moe','fame')): continue
            if 'TOTAL' in ' '.join(vals).upper(): continue
            fe,me=v['fae'],v['moe']
            if v['fame'] and not fe and not me:  # one family email column: give it to the parent it looks like
                fe,me=('',v['fame']) if owner(v['fame'],v['fa'],v['mo'])=='m' else (v['fame'],'')
            main=email(fe) or email(me)  # prefer the parent who has an email, father first
            recs.append({'Roles':'n' if m.get('roles') is False else '','E-mail':main,'E-mail Father':fe,'E-mail Mother':me,
                         'Phone Father':v['fap'],'Phone Mother':v['mop'],"Father's Name":v['fa'],'I/C No':v['faic'],
                         "Mother's Name":v['mo'],'I/C No.1':v['moic'],'Address':v['addr']})
        df=pd.DataFrame(recs,columns=['Roles']+MAIN_COLS+["Father's Name",'I/C No',"Mother's Name",'I/C No.1','Address'])
        yield name,df[MAIN_COLS+[c for c in df.columns if c not in MAIN_COLS]]

def convert(df):
    """One row per parent (father and mother separately), each with only that person's details."""
    df=df.fillna(''); c=df.columns
    fa=col(df,"father's/guardian's name","father's name"); mo=col(df,"mother's name"); gu=col(df,'name (guardian)','emergency contact')
    fic=col(df,'mykad','i/c no'); mic=col(df,'mykad.1','i/c no.1'); gic=col(df,'mykad.2')
    ad=col(df,'address'); pr=col(df,'primary phone'); gp=col(df,'phone'); roles=col(df,'roles')
    rows=[]
    for i in df.index:
        r=df.loc[i]
        F=dict(role='f',name=s(fa[i]),ic=fic[i],em=[email(r[c[1]])],ph=[phone(r[c[3]])])
        M=dict(role='m',name=s(mo[i]),ic=mic[i],em=[email(r[c[2]])],ph=[phone(r[c[4]])])
        if s(roles[i])=='n': F['role']=M['role']=''  # "Parents 1/2": slot says nothing about gender
        # an email both parents share goes to the one it resembles; a shared phone stays with parent 1
        e=F['em'][0]
        if e and e==M['em'][0]:
            (M if owner(e,F['name'],M['name'])=='m' else F)['em']=[e]; (F if owner(e,F['name'],M['name'])=='m' else M)['em']=['']
        if F['ph'][0] and F['ph'][0]==M['ph'][0]: M['ph']=['']
        # main email / primary phone that neither parent column holds: give to the parent it resembles
        pe=email(r[c[0]])
        if pe and pe not in F['em']+M['em']: (M if owner(pe,F['name'],M['name'])=='m' else F)['em'].append(pe)
        pp=phone(pr[i])
        if pp and pp not in F['ph']+M['ph']: (F if not F['ph'][0] else M)['ph'].append(pp)
        people=[F,M]
        if not any(x for P in people for x in P['em']+P['ph']):  # no parent contact: use guardian / emergency
            people=[dict(role='',name=s(gu[i]),ic=gic[i],em=[],ph=[phone(gp[i])])]
        z,ct,st=addr(ad[i])
        for P in people:
            e=[x for x in dict.fromkeys(P['em']) if x][:3]; p=[x for x in dict.fromkeys(P['ph']) if x][:3]
            if not e and not p: continue
            nm=P['name']; fn,ln=split(nm); info=ic(P['ic'])
            gen={'f':'m','m':'f'}.get(P['role'],'') if nm else ''
            ng=name_gen(nm)
            if ng: gen=ng
            if info and ng and info[2]!=ng: info=None  # IC belongs to the other parent (mixed-up columns)
            dob=doby=age=''
            if info: dob,doby,age=info[0].isoformat(),str(info[0].year),str(info[1]); gen=info[2]
            rows.append(tuple(e+['']*(3-len(e))+p+['']*(3-len(p))+['',fn,ln,z,ct,st,'MY',dob,doby,gen,age,'','']))
    return rows

def dedupe(rows):
    """One row per person: rows sharing an email, a phone, or the same full name (2+ words) are merged,
    keeping every email/phone (max 3 each) and the first non-empty value of the other fields."""
    par=list(range(len(rows)))
    def find(x):
        while par[x]!=x: par[x]=par[par[x]]; x=par[x]
        return x
    who={i:{(re.sub(r'[^a-z]','',r[7].lower())[:4],r[15])} for i,r in enumerate(rows)}  # (name start, gen) per group
    def ok(a,b):  # never merge two different people (father + mother sharing a phone)
        for n1,g1 in who[a]:
            for n2,g2 in who[b]:
                if (g1 and g2 and g1!=g2) or (n1 and n2 and n1!=n2): return False
        return True
    seen={}
    for i,r in enumerate(rows):
        keys=[x for x in r[:6] if x]
        full=(r[7]+' '+r[8]).strip().lower()
        if len(full.split())>=2: keys.append('name:'+full)
        for k in keys:
            if k in seen:
                a,b=find(i),find(seen[k])
                if a!=b and ok(a,b): par[a]=b; who[b]|=who.pop(a)
            else: seen[k]=i
    groups={}
    for i in range(len(rows)): groups.setdefault(find(i),[]).append(rows[i])
    out=[]
    for g in groups.values():
        g=sorted(g,key=lambda r:-sum(bool(v) for v in r))  # most complete row first
        e=[x for x in dict.fromkeys(v for r in g for v in r[0:3]) if x][:3]
        p=[x for x in dict.fromkeys(v for r in g for v in r[3:6]) if x][:3]
        rest=[next((r[k] for r in g if r[k]),'') for k in range(6,19)]
        if g[0][13]: rest[7:11]=list(g[0][13:17])  # keep dob/doby/gen/age together from one MyKad
        out.append(tuple(e+['']*(3-len(e))+p+['']*(3-len(p))+rest))
    # an email/phone left on two people's rows (shared family phone): keep it only where it is the row's only contact
    cnt={}
    for r in out:
        for x in r[:6]:
            if x: cnt[x]=cnt.get(x,0)+1
    fixed=[]
    for r in out:
        keep=[x for x in r[:6] if x and cnt[x]==1]
        e=[x for x in r[0:3] if x and (cnt[x]==1 or not keep)]; p=[x for x in r[3:6] if x and (cnt[x]==1 or not keep)]
        fixed.append(tuple(e+['']*(3-len(e))+p+['']*(3-len(p))+list(r[6:])))
    return fixed

def write(rows,tab,out):
    wb=Workbook(); ws=wb.active; ws.title=tab[:31]; ws.append(HDR)
    for rr in rows: ws.append([v if v!='' else None for v in rr])
    for cell in ws[1]: cell.font=Font(name='Arial',bold=True,color='FFFFFF'); cell.fill=PatternFill('solid',fgColor='1877F2')
    for row in ws.iter_rows(min_row=2):
        for cell in row: cell.font=Font(name='Arial'); cell.number_format='@'
    for k,w in enumerate([30,30,30,15,15,15,8,20,22,8,20,16,9,12,7,6,6,6,7],1): ws.column_dimensions[get_column_letter(k)].width=w
    ws.freeze_panes='A2'; wb.save(out)

def label(path):
    n=os.path.splitext(os.path.basename(path))[0]
    n=re.sub(r'^[0-9a-f]{8}-','',n)            # upload prefix
    n=re.sub(r'HH_DATABASE|DATABASE','',n,flags=re.I)
    return re.sub(r'[_\s]+',' ',n).strip().upper() or 'ALL CENTRES'

if __name__=='__main__':
    ap=argparse.ArgumentParser(description='Convert centre databases to the Meta customer list format.')
    ap.add_argument('inputs',nargs='+',help='.xlsx files; each one becomes its own output file with one tab')
    ap.add_argument('-o','--outdir',default='.',help='folder for the output files')
    ap.add_argument('--per-tab',action='store_true',help='one output file per tab (e.g. one per centre) instead of one per input file')
    ap.add_argument('--suffix',default='',help="added to the end of each output file name, e.g. _v2")
    a=ap.parse_args()
    for path in a.inputs:
        if a.per_tab:  # every tab (centre) becomes its own file
            for name,df in read_sheets(path):
                rows=dedupe(convert(df)); lab=re.sub(r'\s+',' ',name).strip().upper()
                out=os.path.join(a.outdir,'META_'+lab.replace(' ','_')+a.suffix+'.xlsx')
                write(rows,lab,out); print(f'{out}: {len(rows)} rows')
            continue
        rows=[]; per=[]
        for name,df in read_sheets(path):
            r=convert(df); rows+=r; per.append((name.strip(),len(r)))
        rows=dedupe(rows)  # same parent listed for several children / tabs
        lab=label(path); out=os.path.join(a.outdir,'META_'+lab.replace(' ','_')+a.suffix+'.xlsx')
        write(rows,lab,out)
        print(f'{out}: {len(rows)} rows  (per tab before de-dupe: {per})')
