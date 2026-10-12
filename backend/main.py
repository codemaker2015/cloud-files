"""One small API over three object stores: S3 (AWS), Blob (Azure), GCS (GCP).
Each provider talks to its Floci emulator; the UI never knows which one it is."""
import mimetypes
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import boto3
from botocore.config import Config
from azure.storage.blob import BlobPrefix, BlobSasPermissions, BlobServiceClient, generate_blob_sas
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from google.auth.credentials import AnonymousCredentials
from google.cloud import storage as gcs

AZ_KEY = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=="
# Addresses a *browser* can reach (host-mapped ports), used for shareable links
PUB_AWS = os.getenv("PUBLIC_AWS_ENDPOINT", "http://localhost:4566")
PUB_AZ = os.getenv("PUBLIC_AZURE_ENDPOINT", "http://localhost:4577")
PUB_GCP = os.getenv("PUBLIC_GCP_ENDPOINT", "http://localhost:4588")


class Store:
    """Common interface: containers are buckets, keys use '/' as folder separator."""
    def keys(self, c, prefix): raise NotImplementedError
    def purge(self, c, prefix=""):
        for k in self.keys(c, prefix):
            self.rm(c, k)


class S3(Store):
    def __init__(self):
        self.c = boto3.client(
            "s3", endpoint_url=os.getenv("AWS_ENDPOINT", "http://localhost:4566"),
            region_name="us-east-1", aws_access_key_id="test", aws_secret_access_key="test",
            config=Config(s3={"addressing_style": "path"}))
    def containers(self): return [b["Name"] for b in self.c.list_buckets()["Buckets"]]
    def create(self, n): self.c.create_bucket(Bucket=n)
    def drop(self, n): self.purge(n); self.c.delete_bucket(Bucket=n)
    def ls(self, b, p):
        folders, files = [], []
        for page in self.c.get_paginator("list_objects_v2").paginate(Bucket=b, Prefix=p, Delimiter="/"):
            folders += [x["Prefix"] for x in page.get("CommonPrefixes", [])]
            files += [{"key": o["Key"], "size": o["Size"], "modified": o["LastModified"].isoformat()}
                      for o in page.get("Contents", []) if o["Key"] != p]
        return folders, files
    def put(self, b, k, d): self.c.put_object(Bucket=b, Key=k, Body=d)
    def get(self, b, k): return self.c.get_object(Bucket=b, Key=k)["Body"].read()
    def rm(self, b, k): self.c.delete_object(Bucket=b, Key=k)
    def keys(self, b, p):
        return [o["Key"] for pg in self.c.get_paginator("list_objects_v2").paginate(Bucket=b, Prefix=p)
                for o in pg.get("Contents", [])]
    def head(self, b, k):
        r = self.c.head_object(Bucket=b, Key=k)
        return r["ContentLength"], r["LastModified"].isoformat()
    def uris(self, b, k): return f"s3://{b}/{k}", f"{PUB_AWS}/{b}/{quote(k)}"
    def share(self, b, k, secs):   # presigned URL, signed for the host-reachable endpoint
        pub = boto3.client("s3", endpoint_url=PUB_AWS, region_name="us-east-1", aws_access_key_id="test",
                           aws_secret_access_key="test", config=Config(s3={"addressing_style": "path"}))
        return pub.generate_presigned_url("get_object", Params={"Bucket": b, "Key": k}, ExpiresIn=secs)
    def walk(self, b):
        for pg in self.c.get_paginator("list_objects_v2").paginate(Bucket=b):
            for o in pg.get("Contents", []):
                yield o["Key"], o["Size"], o["LastModified"].isoformat()


class Azure(Store):
    def __init__(self):
        ep = os.getenv("AZURE_ENDPOINT", "http://localhost:4577")
        self.c = BlobServiceClient.from_connection_string(
            f"DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey={AZ_KEY};"
            f"BlobEndpoint={ep}/devstoreaccount1;")
    def containers(self): return [x.name for x in self.c.list_containers()]
    def create(self, n): self.c.create_container(n)
    def drop(self, n): self.c.delete_container(n)
    def ls(self, b, p):
        folders, files = [], []
        for it in self.c.get_container_client(b).walk_blobs(name_starts_with=p, delimiter="/"):
            if isinstance(it, BlobPrefix):
                folders.append(it.name)
            elif it.name != p:
                files.append({"key": it.name, "size": it.size, "modified": it.last_modified.isoformat()})
        return folders, files
    def put(self, b, k, d): self.c.get_container_client(b).upload_blob(k, d, overwrite=True)
    def get(self, b, k): return self.c.get_container_client(b).download_blob(k).readall()
    def rm(self, b, k): self.c.get_container_client(b).delete_blob(k)
    def keys(self, b, p): return [x.name for x in self.c.get_container_client(b).list_blobs(name_starts_with=p)]
    def head(self, b, k):
        x = self.c.get_container_client(b).get_blob_client(k).get_blob_properties()
        return x.size, x.last_modified.isoformat()
    def uris(self, b, k): return f"https://devstoreaccount1.blob.core.windows.net/{b}/{k}", f"{PUB_AZ}/devstoreaccount1/{b}/{quote(k)}"
    def share(self, b, k, secs):   # SAS token
        sas = generate_blob_sas(account_name="devstoreaccount1", container_name=b, blob_name=k, account_key=AZ_KEY,
                                permission=BlobSasPermissions(read=True),
                                expiry=datetime.now(timezone.utc) + timedelta(seconds=secs))
        return f"{PUB_AZ}/devstoreaccount1/{b}/{quote(k)}?{sas}"
    def walk(self, b):
        for x in self.c.get_container_client(b).list_blobs():
            yield x.name, x.size, x.last_modified.isoformat()


class GCS(Store):
    def __init__(self):
        self.c = gcs.Client(project="floci", credentials=AnonymousCredentials(),
                            client_options={"api_endpoint": os.getenv("GCP_ENDPOINT", "http://localhost:4588")})
    def containers(self): return [b.name for b in self.c.list_buckets()]
    def create(self, n): self.c.create_bucket(n)
    def drop(self, n): self.purge(n); self.c.bucket(n).delete()
    def ls(self, b, p):
        it = self.c.list_blobs(b, prefix=p, delimiter="/")
        files = [{"key": x.name, "size": x.size or 0, "modified": x.updated.isoformat() if x.updated else ""}
                 for x in it if x.name != p]
        return sorted(it.prefixes), files          # prefixes are only filled after iterating
    def put(self, b, k, d): self.c.bucket(b).blob(k).upload_from_string(d)
    def get(self, b, k): return self.c.bucket(b).blob(k).download_as_bytes()
    def rm(self, b, k): self.c.bucket(b).blob(k).delete()
    def keys(self, b, p): return [x.name for x in self.c.list_blobs(b, prefix=p)]
    def head(self, b, k):
        x = self.c.bucket(b).get_blob(k)
        return x.size or 0, x.updated.isoformat() if x.updated else ""
    def uris(self, b, k): return f"gs://{b}/{k}", f"{PUB_GCP}/storage/v1/b/{b}/o/{quote(k, safe='')}?alt=media"
    def share(self, b, k, secs):   # the emulator serves objects openly, so the media link is the share link
        return self.uris(b, k)[1]
    def walk(self, b):
        for x in self.c.list_blobs(b):
            yield x.name, x.size or 0, x.updated.isoformat() if x.updated else ""


FACTORIES = {"aws": S3, "azure": Azure, "gcp": GCS}
_cache = {}

def store(p):
    if p not in FACTORIES:
        raise HTTPException(404, f"Unknown provider '{p}'")
    if p not in _cache:
        _cache[p] = FACTORIES[p]()
    return _cache[p]


app = FastAPI()

@app.exception_handler(Exception)
async def on_error(_: Request, e: Exception):
    return JSONResponse({"detail": f"{type(e).__name__}: {e}"}, status_code=500)

@app.get("/api/{p}/b")
def list_buckets(p: str): return store(p).containers()

@app.post("/api/{p}/b")
async def create_bucket(p: str, req: Request):
    store(p).create((await req.json())["name"]); return {"ok": True}

@app.delete("/api/{p}/b/{b}")
def delete_bucket(p: str, b: str): store(p).drop(b); return {"ok": True}

@app.get("/api/{p}/b/{b}/ls")
def ls(p: str, b: str, prefix: str = ""):
    folders, files = store(p).ls(b, prefix)
    return {"folders": folders, "files": files}

@app.post("/api/{p}/b/{b}/upload")
async def upload(p: str, b: str, prefix: str = Form(""), files: list[UploadFile] = File(...)):
    for f in files:
        store(p).put(b, prefix + f.filename, await f.read())
    return {"uploaded": len(files)}

@app.post("/api/{p}/b/{b}/folder")
async def new_folder(p: str, b: str, req: Request):
    path = (await req.json())["path"].strip("/") + "/"
    store(p).put(b, path, b"")                      # zero-byte marker so empty folders show up
    return {"ok": True}

@app.get("/api/{p}/b/{b}/download")
def download(p: str, b: str, key: str, inline: bool = False):
    name = key.rsplit("/", 1)[-1]
    kind = "inline" if inline else "attachment"
    return Response(store(p).get(b, key), media_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
                    headers={"Content-Disposition": f"{kind}; filename*=UTF-8''{quote(name)}"})

@app.get("/api/{p}/b/{b}/meta")
def meta(p: str, b: str, key: str):
    s = store(p)
    uri, url = s.uris(b, key)
    name = key.rstrip("/").rsplit("/", 1)[-1]
    out = {"name": name, "key": key, "bucket": b, "uri": uri, "url": url, "folder": key.endswith("/")}
    if out["folder"]:
        out["count"] = len([k for k in s.keys(b, key) if k != key])
    else:
        out["size"], out["modified"] = s.head(b, key)
        out["type"] = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return out

@app.post("/api/{p}/b/{b}/share")
async def share(p: str, b: str, req: Request):
    d = await req.json()
    secs = int(d.get("expires", 3600))
    return {"url": store(p).share(b, d["key"], secs), "expires": secs}

@app.post("/api/{p}/transfer")
async def transfer(p: str, req: Request):
    """Copy or move a file or folder (key ending in '/') to any bucket/folder of the same cloud."""
    d = await req.json()
    s, sb, db, key, dst = store(p), d["src_bucket"], d["dst_bucket"], d["key"], d.get("dst_prefix", "")
    if key.endswith("/") and sb == db and dst.startswith(key):
        raise HTTPException(400, "Cannot copy or move a folder into itself")
    name = key.rstrip("/").rsplit("/", 1)[-1] + ("/" if key.endswith("/") else "")
    moves = [(k, dst + name + k[len(key):]) for k in (s.keys(sb, key) if key.endswith("/") else [key])]
    moves = [(a, z) for a, z in moves if not (sb == db and a == z)]
    for a, z in moves:
        s.put(db, z, s.get(sb, a))
    if d.get("move"):
        for a, _ in moves:
            s.rm(sb, a)
    return {"count": len(moves)}

@app.delete("/api/{p}/b/{b}/object")
def delete_object(p: str, b: str, key: str):
    s = store(p)
    if key.endswith("/"): s.purge(b, key)          # folder: delete everything under it
    else: s.rm(b, key)
    return {"ok": True}

@app.get("/api/{p}/search")
def search(p: str, q: str, limit: int = 200):
    """Case-insensitive search over bucket names, folder paths, and file paths for one provider."""
    s, needle = store(p), q.strip().lower()
    all_buckets = s.containers()
    out_buckets = [{"name": b} for b in all_buckets if needle in b.lower()]
    out_folders, out_files = [], []
    for b in all_buckets:
        for key, sz, modified in s.walk(b):
            if key.endswith("/"):
                if needle in key.lower():
                    name = key.rstrip("/").rsplit("/", 1)[-1]
                    parent = key[:len(key) - len(name) - 1]
                    out_folders.append({"bucket": b, "key": key, "name": name,
                                        "path": (parent + "/") if parent else "", "folder": True})
            elif needle in key.lower():
                name = key.rsplit("/", 1)[-1]
                out_files.append({"bucket": b, "key": key, "name": name,
                                  "path": key[:len(key) - len(name)], "size": sz, "modified": modified})
                if len(out_files) >= limit:
                    return {"q": q, "buckets": out_buckets, "folders": out_folders, "files": out_files,
                            "truncated": True, "searched": len(all_buckets)}
    return {"q": q, "buckets": out_buckets, "folders": out_folders, "files": out_files,
            "truncated": False, "searched": len(all_buckets)}
