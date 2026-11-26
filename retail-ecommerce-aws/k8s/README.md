# Kubernetes deployment

These manifests deploy the retail application to Amazon EKS (and work with any cluster that has an nginx ingress controller, metrics-server, and a PostgreSQL endpoint reachable from the pods).

## One-time setup

1. Provision EKS, ECR, and RDS PostgreSQL with `infra/terraform/`.
2. Install an nginx ingress controller, cert-manager (with CRDs), and metrics-server. Configure a DNS CNAME for the ingress load balancer and use an operations email for ACME.
3. Connect to EKS and create the application secret. Keep real credentials in AWS Secrets Manager or your CI secret store; never commit them.

   ```bash
   kubectl create namespace retail --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n retail create secret generic retail-secrets \
     --from-literal=DB_HOST='RDS_ENDPOINT' \
     --from-literal=DB_USER='retailadmin' \
     --from-literal=DB_PASSWORD='REPLACE_WITH_SECRET' \
     --from-literal=ADMIN_TOKEN='REPLACE_WITH_A_LONG_RANDOM_SECRET' \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

4. Apply `certificate-issuer.yaml` and replace its placeholder contact email with the operations email:

   ```bash
   kubectl apply -f retail-ecommerce-aws/k8s/certificate-issuer.yaml
   kubectl patch clusterissuer retail-letsencrypt --type=merge \
     -p='{"spec":{"acme":{"email":"ops@example.com"}}}'
   ```

5. Change both occurrences of `shop.example.com` in `ingress.yaml` to the DNS name you control.

## Deploy and operate

```bash
kubectl apply -k retail-ecommerce-aws/k8s
kubectl -n retail set image deployment/retail app=ACCOUNT.dkr.ecr.REGION.amazonaws.com/retail-ecommerce:TAG
kubectl -n retail rollout status deployment/retail
kubectl -n retail wait --for=condition=Ready certificate/retail-tls --timeout=10m
kubectl -n retail get ingress,service,pods,hpa,pdb
```

The base includes restricted pod security, non-root execution, resource limits, health checks, replicas, CPU autoscaling, disruption budget, and ingress-only network policy. Ensure the cluster's CNI enforces NetworkPolicy and that the ingress controller is labeled in the `ingress-nginx` namespace. Roll back with `kubectl -n retail rollout undo deployment/retail`.
