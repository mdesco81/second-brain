# Deploy no AWS Lightsail (24/7)

Este guia sobe o Second Brain em uma VPS Lightsail com Docker, Postgres local, HTTPS via Caddy e webhook Telegram.

## 1) Criar a instância no Lightsail

No console AWS Lightsail:

1. `Create instance`
2. Plataforma: `Linux/Unix`
3. Blueprint: `OS Only` -> `Ubuntu 24.04 LTS` (recomendado)
4. Plano: para MVP, comece em 1-2 GB RAM
5. Nome: ex. `second-brain-prod`

Depois, abra a instância e conecte por SSH.

## 2) Networking obrigatório

1. Crie e anexe um `Static IP` para não perder IP após reboot.
2. Em `Networking` da instância, libere firewall:
   - `TCP 22` (SSH)
   - `TCP 80` (HTTP)
   - `TCP 443` (HTTPS)

## 3) DNS

Você precisa de um domínio/subdomínio para webhook HTTPS.

1. Crie uma DNS zone (Lightsail ou no seu provedor DNS)
2. Aponte um registro `A` para o Static IP
   - Exemplo: `brain.seudominio.com -> <STATIC_IP>`

## 4) Instalar Docker na instância

No servidor:

```bash
sudo apt update && sudo apt install -y git
git clone <SEU_REPO_URL> second-brain
cd second-brain
bash scripts/install_docker_ubuntu.sh
newgrp docker
```

## 5) Configurar variáveis de produção

```bash
cp .env.production.example .env.production
nano .env.production
```

Preencha:

- `DOMAIN` (ex. `brain.seudominio.com`)
- `POSTGRES_PASSWORD`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (somente `A-Z a-z 0-9 _ -`)
- `OPENAI_API_KEY`
- `TIMEZONE`, `PROACTIVE_HOUR`, `PROACTIVE_MINUTE`

## 6) Subir stack de produção

```bash
bash scripts/deploy_lightsail.sh
```

Esse comando usa `docker-compose.prod.yml` e sobe:

- `postgres`
- `app` (Second Brain)
- `caddy` (TLS automático)

## 7) Verificações

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -I https://SEU_DOMINIO/api/health
```

Dashboard:

- `https://SEU_DOMINIO`

Webhook:

- O app tenta configurar automaticamente em boot e faz retry a cada 60s.

## 8) Operação diária

Logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
```

Atualização de versão:

```bash
git pull
bash scripts/deploy_lightsail.sh
```

Backup manual:

```bash
bash scripts/backup_data.sh
```

## 9) Snapshot de infra

No Lightsail, habilite `Automatic snapshots` da instância para proteção extra da VPS.

## 10) Fallback sem domínio (temporário)

Se o domínio ainda não estiver pronto, você pode usar polling:

- No `docker-compose.prod.yml`, altere `TELEGRAM_MODE` para `polling`
- Remova dependência de `APP_BASE_URL` até o domínio ficar pronto

Depois volte para webhook.

## Referências oficiais

- AWS Lightsail: criar instância Linux
  - https://docs.aws.amazon.com/lightsail/latest/userguide/getting-started-with-amazon-lightsail.html
- AWS Lightsail: Static IP
  - https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html
- AWS Lightsail: firewall rules
  - https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-editing-firewall-rules.html
- AWS Lightsail: DNS zone e records
  - https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-create-dns-entry.html
- AWS Lightsail: automatic snapshots
  - https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configuring-automatic-snapshots.html
- Telegram Bot API: webhook / secret token
  - https://core.telegram.org/bots/api#setwebhook
- Docker Engine em Ubuntu
  - https://docs.docker.com/engine/install/ubuntu/
