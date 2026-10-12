import { useState } from "react";

const CONN = [
  ["Endpoint (from your machine)", "http://localhost:4566"],
  ["Endpoint (inside Compose)", "http://floci:4566"],
  ["Region", "us-east-1"],
  ["Access key / secret", "test / test"],
  ["Addressing style", "path  (endpoint/bucket/key)"],
  ["S3 URI", "s3://bucket/folder/file.txt"],
  ["Object URL", "http://localhost:4566/bucket/folder/file.txt"],
];

const TABS = [
  { id: "boto3", title: "boto3", intro: "boto3 is the official AWS SDK. Point it at Floci with endpoint_url and everything else works as on AWS.", blocks: [
    ["Connect", `import boto3
from botocore.config import Config

s3 = boto3.client(
    "s3",
    endpoint_url="http://localhost:4566",
    region_name="us-east-1",
    aws_access_key_id="test",
    aws_secret_access_key="test",
    config=Config(s3={"addressing_style": "path"}),
)`],
    ["Buckets and uploads", `s3.create_bucket(Bucket="demo")
print([b["Name"] for b in s3.list_buckets()["Buckets"]])

s3.upload_file("report.pdf", "demo", "docs/report.pdf")      # from disk
s3.put_object(Bucket="demo", Key="notes/hello.txt", Body=b"hi")  # from memory
s3.put_object(Bucket="demo", Key="empty-folder/")                # an empty "folder"`],
    ["List files and folders", `# S3 has no real folders: Delimiter="/" groups keys by their next "/"
r = s3.list_objects_v2(Bucket="demo", Prefix="docs/", Delimiter="/")
folders = [p["Prefix"] for p in r.get("CommonPrefixes", [])]
files = [(o["Key"], o["Size"]) for o in r.get("Contents", [])]`],
    ["Download", `s3.download_file("demo", "docs/report.pdf", "report-copy.pdf")
data = s3.get_object(Bucket="demo", Key="notes/hello.txt")["Body"].read()`],
    ["Copy and move", `src = {"Bucket": "demo", "Key": "docs/report.pdf"}
s3.copy_object(Bucket="archive", Key="docs/report.pdf", CopySource=src)  # copy
s3.delete_object(**src)                                                  # + delete = move`],
    ["Search across all buckets", `needle = "report"
for b in s3.list_buckets()["Buckets"]:
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=b["Name"]):
        for o in page.get("Contents", []):
            if needle in o["Key"].lower():
                print(f"s3://{b['Name']}/{o['Key']}", o["Size"])`],
    ["Share with a link", `url = s3.generate_presigned_url(
    "get_object",
    Params={"Bucket": "demo", "Key": "docs/report.pdf"},
    ExpiresIn=3600,          # seconds
)
print(url)   # anyone with this URL can read the file until it expires`],
    ["Delete", `s3.delete_object(Bucket="demo", Key="docs/report.pdf")
s3.delete_bucket(Bucket="demo")   # bucket must be empty`],
  ]},
  { id: "app", title: "requests: this app's API", intro: "The backend in this project is a small REST API in front of S3, Azure Blob and GCS. Swap aws for azure or gcp and the same calls work.", blocks: [
    ["Setup", `import requests

API = "http://localhost:3000/api/aws"   # or /azure, /gcp`],
    ["Buckets", `requests.post(f"{API}/b", json={"name": "demo"})
print(requests.get(f"{API}/b").json())
requests.delete(f"{API}/b/demo")`],
    ["Upload, list, download", `with open("report.pdf", "rb") as f:
    requests.post(f"{API}/b/demo/upload", data={"prefix": "docs/"}, files=[("files", f)])

ls = requests.get(f"{API}/b/demo/ls", params={"prefix": "docs/"}).json()
print(ls["folders"], ls["files"])

blob = requests.get(f"{API}/b/demo/download", params={"key": "docs/report.pdf"}).content`],
    ["Properties and share link", `meta = requests.get(f"{API}/b/demo/meta", params={"key": "docs/report.pdf"}).json()
print(meta["uri"], meta["size"], meta["type"])

link = requests.post(f"{API}/b/demo/share", json={"key": "docs/report.pdf", "expires": 3600}).json()
print(link["url"])`],
    ["Search all buckets", `hits = requests.get(f"{API}/search", params={"q": "report"}).json()
for h in hits["results"]:
    print(h["bucket"], h["key"], h["size"])   # also: hits["truncated"], hits["searched"]`],
    ["Copy or move", `# key ending in "/" transfers a whole folder
requests.post(f"{API}/transfer", json={
    "src_bucket": "demo", "key": "docs/",
    "dst_bucket": "archive", "dst_prefix": "2026/",
    "move": False,        # True = move
})`],
    ["Delete", `requests.delete(f"{API}/b/demo/object", params={"key": "docs/report.pdf"})
requests.delete(f"{API}/b/demo/object", params={"key": "docs/"})   # folder + contents`],
  ]},
  { id: "raw", title: "requests: raw S3 REST", intro: "S3 is plain HTTP underneath. Sign requests with SigV4 (pip install requests-aws4auth) and call it directly, no SDK needed.", blocks: [
    ["Setup", `import requests
from requests_aws4auth import AWS4Auth

BASE = "http://localhost:4566"
auth = AWS4Auth("test", "test", "us-east-1", "s3")`],
    ["Create, upload, read", `requests.put(f"{BASE}/demo", auth=auth)                          # create bucket
requests.put(f"{BASE}/demo/notes/hello.txt", data=b"hi", auth=auth)  # upload
print(requests.get(f"{BASE}/demo/notes/hello.txt", auth=auth).text)  # download`],
    ["List (returns XML)", `r = requests.get(f"{BASE}/demo",
                 params={"list-type": 2, "prefix": "notes/", "delimiter": "/"}, auth=auth)
print(r.text)`],
    ["Copy and delete", `requests.put(f"{BASE}/archive/hello.txt", auth=auth,
             headers={"x-amz-copy-source": "/demo/notes/hello.txt"})
requests.delete(f"{BASE}/demo/notes/hello.txt", auth=auth)`],
    ["Public link", `# A presigned URL needs no auth at all, so a plain GET works
print(requests.get(url).status_code)   # url from generate_presigned_url or the app's Share button`],
  ]},
  { id: "cli", title: "AWS CLI", intro: "The same endpoint works with the AWS CLI.", blocks: [
    ["Configure", `export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test`],
    ["Use it", `aws s3 mb s3://demo
aws s3 cp report.pdf s3://demo/docs/report.pdf
aws s3 ls s3://demo/docs/
aws s3 mv s3://demo/docs/report.pdf s3://archive/report.pdf
aws s3 presign s3://archive/report.pdf --expires-in 3600
aws s3 rm s3://demo --recursive`],
  ]},
];

function Code({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="code">
      <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>{ok ? "Copied" : "Copy"}</button>
      <pre>{text}</pre>
    </div>
  );
}

export default function Docs() {
  const [id, setId] = useState("boto3");
  const tab = TABS.find((t) => t.id === id);
  return (
    <article className="docs">
      <h2>Using S3 from Python</h2>
      <p className="lead">Everything in this app is plain S3 (plus its Azure and GCP equivalents). These recipes talk to the same local Floci endpoint.</p>
      <dl className="conn">{CONN.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={t.id === id} className={t.id === id ? "on" : ""} onClick={() => setId(t.id)}>{t.title}</button>)}
      </div>
      <p>{tab.intro}</p>
      {tab.blocks.map(([h, c]) => <section key={h}><h3>{h}</h3><Code text={c} /></section>)}
    </article>
  );
}
