# Deploy no Amazon EC2

Este guia sobe o Second Brain em uma instância EC2 com Docker, Postgres local, HTTPS via Caddy e webhook Telegram.

## Pré-requisitos

- Instância EC2 rodando (Ubuntu 22.04+ recomendado, mínimo t3.small / 2 GB RAM)
- Docker e Docker Compose instalados (use `scripts/install_docker_ubuntu.sh` se necessário)
- Security Group com portas **22** (SSH), **80** (HTTP) e **443** (HTTPS) liberadas
- Elastic IP associado à instância
- Domínio/subdomínio com registro A apontando para o Elastic IP

## 1) Clonar o repositório

```bash
sudo apt update && sudo apt install -y git
git clone <SEU_REPO_URL> second-brain
cd second-brain
```

Se já clonou antes, atualize:

```bash
cd second-brain
git pull
```

## 2) Configurar variáveis de produção

```bash
cp .env.example .env
nano .env
```

Preencha todos os valores:

| Variável | Descrição |
|---|---|
| `DOMAIN` | Seu domínio (ex. `brain.seudominio.com`) |
| `POSTGRES_PASSWORD` | Senha forte para o banco |
| `TELEGRAM_BOT_TOKEN` | Token do @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret para validar webhook (somente `A-Za-z0-9_-`) |
| `OPENAI_API_KEY` | Chave da API OpenAI |
| `TIMEZONE` | Ex. `America/Sao_Paulo` |
| `PROACTIVE_HOUR` / `PROACTIVE_MINUTE` | Horário do check-in diário |

## 3) Subir stack de produção

```bash
bash scripts/deploy.sh
```

Isso sobe três containers via `docker-compose.prod.yml`:

- **postgres** — banco de dados PostgreSQL 16
- **app** — Second Brain (Node.js)
- **caddy** — reverse proxy com TLS automático (Let's Encrypt)

## 4) Verificações

```bash
# Status dos containers
docker compose --env-file .env -f docker-compose.prod.yml ps

# Health check
curl -I https://SEU_DOMINIO/api/health

# Logs da aplicação
docker compose --env-file .env -f docker-compose.prod.yml logs -f app
```

Dashboard: `https://SEU_DOMINIO`

O webhook do Telegram é configurado automaticamente no boot (com retry a cada 60s).

## 5) Operação diária

### Logs

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f app
```

### Atualizar versão

```bash
cd second-brain
git pull
bash scripts/deploy.sh
```

### Backup manual

```bash
bash scripts/backup_data.sh
```

Gera dumps do Postgres e do storage em `backups/`.

## 6) Security Group (referência)

No console EC2, o Security Group da instância precisa de:

| Tipo | Protocolo | Porta | Origem |
|---|---|---|---|
| SSH | TCP | 22 | Seu IP (recomendado) |
| HTTP | TCP | 80 | 0.0.0.0/0 |
| HTTPS | TCP | 443 | 0.0.0.0/0 |

## 7) Elastic IP (referência)

Sem Elastic IP, o IP público muda a cada reboot. Para associar:

1. Console EC2 → Elastic IPs → Allocate
2. Associate ao ID da instância
3. Atualize o registro DNS A do seu domínio

## 8) Fallback sem domínio (temporário)

Se o domínio não estiver pronto, use polling:

No `.env`, altere a seção do `docker-compose.prod.yml`:
- `TELEGRAM_MODE` para `polling`
- Remova a dependência de `APP_BASE_URL` até o domínio ficar pronto

Depois volte para webhook.

## 9) Dicas de produção EC2

- **Snapshots**: crie AMIs periódicas da instância para disaster recovery
- **CloudWatch**: monitore CPU, memória e disco
- **Swap**: em instâncias com pouca RAM, adicione swap:
  ```bash
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **Updates automáticos de segurança**:
  ```bash
  sudo apt install -y unattended-upgrades
  sudo dpkg-reconfigure -plow unattended-upgrades
  ```

## Referências

- [EC2 — Getting Started](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html)
- [Elastic IP](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)
- [Security Groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html)
- [Telegram Bot API — setWebhook](https://core.telegram.org/bots/api#setwebhook)
- [Docker Engine em Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
