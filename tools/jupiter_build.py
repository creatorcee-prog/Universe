# Jupiter map from the Hubble OPAL 2016 photograph (one hemisphere), reprojected; the unseen longitudes
# are filled with offset (some mirrored) copies of the photographed hemisphere, crossfaded, with the
# Great Red Spot painted out of the copies.
from PIL import Image; import numpy as np, sys
P, OUT = sys.argv[1], sys.argv[2]
ph=np.asarray(Image.open(P).convert('RGB')).astype(float)/255
cx,Re=1137.5,984.5; Rp=Re*0.9351; cy=2056-Rp
W,H=2048,1024
latd=(90-(np.arange(H)+0.5)/H*180)[:,None]*np.ones((1,W))
lond=((np.arange(W)+0.5)/W*360-180)[None,:]*np.ones((H,1))
def samp(img,sx,sy):
    h,w=img.shape[:2]
    x0=np.clip(np.floor(sx).astype(int),0,w-2); y0=np.clip(np.floor(sy).astype(int),0,h-2)
    fx=np.clip(sx-x0,0,1)[...,None]; fy=np.clip(sy-y0,0,1)[...,None]
    return img[y0,x0]*(1-fx)*(1-fy)+img[y0,x0+1]*fx*(1-fy)+img[y0+1,x0]*(1-fx)*fy+img[y0+1,x0+1]*fx*fy
def photo(lat_d, lr_d):
    la=np.radians(lat_d); lr=np.radians(lr_d)
    X=np.cos(la)*np.sin(lr); Y=np.sin(la); Z=np.cos(la)*np.cos(lr)
    c=samp(ph,cx+X*Re,cy-Y*Rp)/np.clip(Z,0.08,1)[...,None]**0.3   # undo limb darkening
    a=np.clip(((c[...,2]-c[...,0])-0.03)/0.06,0,1)*np.clip((lat_d-35)/10,0,1)  # UV aurora
    vis=np.clip((Z-0.1)/0.5,0,1)**3
    return c, vis*(1-a)+1e-5
GRS=(-20.0,28.7)
L0=-107.5-28.7
dg=((lond-(L0+GRS[1])+180)%360)-180
grsm=np.clip(1.8-((dg/16)**2+((latd-GRS[0])/10)**2),0,1)
out=np.zeros((H,W,3)); wsum=np.zeros((H,W))
for k,(sgn,off) in enumerate([(1,0),(1,-22),(-1,15),(1,25),(-1,-18),(1,-8)]):
    d=((lond-(L0+60*k)+180)%360)-180
    wk=np.clip(1-np.abs(d)/60,0,1)
    lr=sgn*d+off
    c,v=photo(latd,lr)
    if k:
        m=np.clip(1.6-(((lr-GRS[1])/13)**2+((latd-GRS[0])/8)**2),0,1)[...,None]
        c2,_=photo(latd,lr-32)
        c=c*(1-m)+c2*m
        wk=wk*(1-grsm)
    else:
        wk=np.maximum(wk,grsm)
    wk=wk*v
    out+=c*wk[...,None]; wsum+=wk
out/=np.maximum(wsum,1e-9)[...,None]
pw=np.clip((np.abs(latd)-52)/16,0,1); pw=(pw*pw*(3-2*pw))[...,None]
north=out[np.argmin(np.abs(latd[:,0]-52))].mean(0); south=out[np.argmin(np.abs(latd[:,0]+52))].mean(0)
out=out*(1-pw)+np.where(latd[...,None]>0,north,south)*pw
k=24; edge=(out[:,:1]+out[:,-1:])/2
for i in range(k):
    t=(1-i/k)**2; out[:,i]=out[:,i]*(1-t)+edge[:,0]*t; out[:,-1-i]=out[:,-1-i]*(1-t)+edge[:,0]*t
Image.fromarray((np.clip(out,0,1)*255).astype('uint8')).save(OUT,quality=90)
