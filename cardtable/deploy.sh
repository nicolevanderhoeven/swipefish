#!/bin/bash
set -euo pipefail
EMAIL="${EMAIL:-noel@burton-krahn.com}"
DOMAIN="${DOMAIN:-cardtable.swipe.fish}"
NAMESPACE="${NAMESPACE:-cardtable}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
KUSTOMIZE_DIR="${KUSTOMIZE_DIR:-k8s}"

echo "🚀 Deploying cardtable to ${DOMAIN}"
echo ""

echo ""
echo "🔐 Step 2: Preparing kustomize variables..."
cat <<EOF > "${KUSTOMIZE_DIR}/deploy.env"
DOMAIN=${DOMAIN}
EMAIL=${EMAIL}
EOF

echo ""
echo "☸️  Step 3: Deploying to Kubernetes..."
kubectl apply -f "${KUSTOMIZE_DIR}/namespace.yaml"

echo ""
echo "🌐 Step 3.1: Ensuring ingress-nginx is installed..."
if ! kubectl get svc -n ingress-nginx ingress-nginx-controller &>/dev/null; then
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.5/deploy/static/provider/cloud/deploy.yaml
fi

if ! kubectl get secret cardtable-secrets -n "${NAMESPACE}" &>/dev/null; then
  echo ""
  echo "⚠️  cardtable-secrets is missing. Generating..."
  if command -v openssl >/dev/null 2>&1; then
    SECRET_KEY_BASE="$(openssl rand -base64 64)"
  else
    SECRET_KEY_BASE="$(docker run --rm --platform ${DOCKER_PLATFORM} alpine:3.20 sh -c 'apk add --no-cache openssl >/dev/null && openssl rand -base64 64')"
  fi
  kubectl create secret generic cardtable-secrets \
    --from-literal=SECRET_KEY_BASE="${SECRET_KEY_BASE}" \
    -n "${NAMESPACE}"
fi

kubectl apply -k "${KUSTOMIZE_DIR}"

SECRET_LEN="$(kubectl get secret cardtable-secrets -n "${NAMESPACE}" -o jsonpath='{.data.SECRET_KEY_BASE}' | wc -c | tr -d ' ')"
if [ "${SECRET_LEN}" -lt 10 ]; then
  echo "cardtable-secrets.SECRET_KEY_BASE is missing or empty"
  exit 1
fi

for key in PORT PHX_HOST PHX_SERVER MIX_ENV; do
  value="$(kubectl get configmap cardtable-config -n "${NAMESPACE}" -o jsonpath="{.data.${key}}" 2>/dev/null || true)"
  if [ -z "${value}" ]; then
    echo "cardtable-config.${key} is missing or empty"
    exit 1
  fi
done

kubectl rollout restart deployment/cardtable -n "${NAMESPACE}"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
if kubectl get svc -n ingress-nginx ingress-nginx-controller &>/dev/null; then
  LB_IP="$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [ -n "${LB_IP}" ]; then
    echo "1) Load balancer IP: ${LB_IP}"
  else
    echo "1) Load balancer IP: pending (check ingress-nginx service)"
  fi
else
  echo "1) ingress-nginx service not found"
fi
echo "2) Point DNS for ${DOMAIN} to the Load Balancer IP"
