# Kubernetes deployment

These manifests deploy the Azure edition to AKS (and work with any cluster that has an nginx ingress controller, metrics-server, and a PostgreSQL endpoint reachable from the pods).

## One-time setup

1. Provision AKS, ACR, and Azure Database for PostgreSQL with `infra/terraform/`.
2. Install an nginx ingress controller and metrics-server; configure a DNS A record for the ingress controller's public address.
3. Connect to AKS and create the runtime secret without committing it:

   ```bash
   kubectl create namespace food-delivery --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n food-delivery create secret generic food-delivery-secrets \
     --from-literal=DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/fooddelivery?sslmode=require' \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

4. Change `food.example.com` in `ingress.yaml` to the DNS name you control.

## Deploy and operate

Build and push the image to the registry output by Terraform, then apply the resources and set the exact image tag:

```bash
kubectl apply -k food-delivery-azure/k8s
kubectl -n food-delivery set image deployment/food-delivery app=REGISTRY/food-delivery:TAG
kubectl -n food-delivery rollout status deployment/food-delivery
kubectl -n food-delivery get ingress,service,pods,hpa,pdb
```

The base enforces a restricted pod security context, non-root execution, resource requests/limits, health probes, two replicas, CPU autoscaling, and a disruption budget. `DATABASE_URL` comes from a Kubernetes Secret. The network policy requires the `ingress-nginx` namespace label and a CNI that enforces NetworkPolicy. Do not apply a real database password from a checked-in manifest.

For rollback, use `kubectl -n food-delivery rollout undo deployment/food-delivery`. Use `kubectl -n food-delivery logs deployment/food-delivery` for application logs.
