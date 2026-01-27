# BEAM clustering (Kubernetes StatefulSet) + laptop Observer + local minikube testing

This document describes how to run **multiple Cardtable pods** as a **distributed Erlang/BEAM cluster** on Kubernetes, how to securely connect **IEx + Observer from a laptop**, and how to test locally using **minikube**.

It is written to match the current Cardtable codebase and manifests under `k8s/`.

## Goals

- Run **N replicas** of Cardtable in Kubernetes and have them form a **BEAM cluster**.
- Use **DNS-based discovery** (`dns_cluster`) via a **headless Service**.
- Support secure, operator-friendly introspection:
  - remote IEx from laptop
  - Observer UI from laptop (GUI runs locally)
- Provide a local workflow using **minikube** that mirrors production patterns.

## Non-goals (this phase)

- Making game state “global” across pods.
  - Today, game state is node-local (see `Registry`/supervisor usage in `lib/cardtable/application.ex`).
  - Your `k8s/ingress.yaml` currently uses sticky sessions; clustering does not remove the need for stickiness unless we implement a distributed registry/process layer or shared persistence later.

## Current code hooks in this repo

- Cardtable starts `DNSCluster` in the supervision tree:
  - `lib/cardtable/application.ex` includes:
    - `{DNSCluster, query: Application.get_env(:cardtable, :dns_cluster_query) || :ignore}`
- Runtime configuration reads the query from an environment variable:
  - `config/runtime.exs`:
    - `config :cardtable, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")`

## Current k8s state (as checked in `k8s/`)

- Workload is currently a **Deployment** (see `k8s/deployment.yaml`) with `replicas: 1`.
- A **headless Service** already exists (also in `k8s/deployment.yaml`):
  - `cardtable-headless` with:
    - port `4369` named `epmd`
    - port `9000` named `dist`
- A ConfigMap already contains `DNS_CLUSTER_QUERY` and `RELEASE_COOKIE`:
  - `k8s/configmap.yaml` sets:
    - `DNS_CLUSTER_QUERY: "cardtable-headless.cardtable.svc.cluster.local"`
    - `RELEASE_COOKIE: "cardtable-cookie"`
- Important: the workload container env currently **does not** pass `DNS_CLUSTER_QUERY` or any release distribution vars into the pod. Until we add them, clustering will not happen.

## Design for production: StatefulSet + headless service + fixed distribution port

### Why StatefulSet

StatefulSets provide stable pod DNS names like:

- `cardtable-0.cardtable-headless.cardtable.svc.cluster.local`
- `cardtable-1.cardtable-headless.cardtable.svc.cluster.local`

That stability makes it straightforward to set `RELEASE_NODE` and to connect from a laptop using `kubectl port-forward`.

### Discovery model

- `dns_cluster` periodically resolves `DNS_CLUSTER_QUERY` and connects to discovered nodes.
- We use a **headless service** for `DNS_CLUSTER_QUERY` so the DNS answer includes all pod IPs.

### Distribution ports model (fixed port)

Distributed Erlang uses:

- **EPMD** on TCP `4369`
- one or more **distribution ports** (dynamic by default)

To simplify networking and laptop access, fix the distribution port to a single value:

- `9000` (matches the existing `cardtable-headless` service port named `dist`)

In practice this is done by setting:

- `ERL_AFLAGS="-kernel inet_dist_listen_min 9000 inet_dist_listen_max 9000"`

## Kubernetes implementation spec (prod)

### 1) Convert workload `Deployment` → `StatefulSet`

Starting from the existing workload in `k8s/deployment.yaml`:

- Change `kind: Deployment` to `kind: StatefulSet`
- Add/ensure:
  - `spec.serviceName: cardtable-headless`
  - `spec.replicas: 2` (or 3)
  - Selector/labels remain `app: cardtable`

No storage is required; StatefulSet is being used for stable identity.

### 2) Keep/ensure the headless service exists

Keep `Service/cardtable-headless` as a headless Service with:

- `clusterIP: None`
- selector `app: cardtable`
- ports:
  - `4369` / `epmd`
  - `9000` / `dist`

### 3) Add required environment variables to the pod template

Add these env vars to the container in the StatefulSet template:

- **Pod identity**
  - `POD_NAMESPACE` via downward API: `metadata.namespace`
- **dns_cluster**
  - `DNS_CLUSTER_QUERY="cardtable-headless.$(POD_NAMESPACE).svc.cluster.local"`
    - This matches the current style in `k8s/configmap.yaml` (hard-coded namespace `cardtable`), but is safer if you ever deploy to another namespace.
- **Release distribution**
  - `RELEASE_DISTRIBUTION=name`
  - `RELEASE_NODE="cardtable@$(HOSTNAME).cardtable-headless.$(POD_NAMESPACE).svc.cluster.local"`
  - `RELEASE_COOKIE` from a Secret (see next section)
- **Fixed dist port**
  - `ERL_AFLAGS="-kernel inet_dist_listen_min 9000 inet_dist_listen_max 9000"`

Notes:
- `$(HOSTNAME)` will be the pod name in a StatefulSet (e.g. `cardtable-0`).
- Keep your existing `PHX_SERVER`, `PHX_HOST`, `PORT`, `SECRET_KEY_BASE`, etc.
- You currently set `ERL_FLAGS` in `k8s/deployment.yaml`; that can remain, but do not confuse it with `ERL_AFLAGS` (they can coexist).

### 4) Move `RELEASE_COOKIE` into a Secret

`RELEASE_COOKIE` is authentication for distributed Erlang. It should not live in a ConfigMap.

Spec:
- Create a Kubernetes Secret (example name):
  - `cardtable-erlang-cookie`
- Store one key (example):
  - `cookie: <random-strong-cookie>`
- Mount as env var:
  - `RELEASE_COOKIE` from that Secret

Operational notes:
- Cookie must be **identical across pods** for them to join the same cluster.
- Rotating the cookie requires coordination (rolling updates will temporarily split the cluster).

### 5) Network policy (optional but recommended)

If/when you add NetworkPolicies, allow only:

- pod↔pod within the `app=cardtable` set:
  - TCP `4369` (EPMD)
  - TCP `9000` (fixed distribution)

Do not expose these ports publicly.

## Validation steps (prod)

After deploying with `replicas >= 2`:

- Pick a pod:
  - `cardtable-0`
- Remote into it (see next section) and verify:
  - `Node.list()` shows peers (e.g. `cardtable@cardtable-1...`)

## Secure laptop access: remote IEx + Observer via kubectl port-forward

This approach avoids “debugging inside the container” while still giving you full introspection. Observer runs on your laptop (GUI), not in the pod.

### Preconditions

- Cluster uses fixed dist port `9000` (per above).
- You can read the cookie (from Secret) as an operator.

### Steps

1) Port-forward EPMD and dist port from one pod:

```bash
kubectl -n cardtable port-forward pod/cardtable-0 4369:4369 9000:9000
```

2) Ensure the pod’s DNS name resolves to localhost on your laptop.

Add a temporary `/etc/hosts` entry:

```text
127.0.0.1 cardtable-0.cardtable-headless.cardtable.svc.cluster.local
```

3) Start a local IEx node with the same cookie:

```bash
iex --name debug@127.0.0.1 --cookie "<RELEASE_COOKIE>"
```

4) Connect to the remote node and start Observer:

```elixir
Node.connect(:"cardtable@cardtable-0.cardtable-headless.cardtable.svc.cluster.local")
Node.list()
:observer.start()
```

Notes:
- Because `kubectl port-forward` binds locally, the `/etc/hosts` mapping is what makes the node name resolvable to `127.0.0.1`.
- If you change the port from `9000`, update the `port-forward` command and `ERL_AFLAGS` consistently.

## Local testing: minikube (recommended for this repo)

Goal: mirror production behavior (StatefulSet + headless DNS discovery) locally.

### Suggested structure

Add a kustomize overlay (later phase) such as:

- `k8s/overlays/minikube/`

Overlay responsibilities:
- replicas: 3
- local hostname/ingress differences (minikube ingress addon vs NodePort)
- a dev `RELEASE_COOKIE` Secret

### Workflow outline

1) Start minikube:

```bash
minikube start
```

2) Make your image available to minikube:

- If you build locally and tag `noelbk/cardtable:latest`, you can load it:

```bash
minikube image load noelbk/cardtable:latest
```

3) Apply the manifests (base or overlay once created):

```bash
kubectl apply -k k8s/
```

4) Scale to 3 replicas (until the overlay exists):

```bash
kubectl -n cardtable scale statefulset/cardtable --replicas=3
```

5) Verify clustering using the port-forward + IEx steps:
- connect to `cardtable-0`
- confirm `Node.list()` includes `cardtable-1`, `cardtable-2`

## Future work (next phase)

After BEAM clustering is stable, decide how to make game state resilient across pods:

- Distributed registry/supervision (e.g. Horde) for game processes, or
- External persistence (DB/Redis) with stateless nodes, or
- Keep sticky sessions and accept pod-local game state (simplest operationally)

