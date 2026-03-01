# Second Brain - Manual do Usuario

**Seu assistente pessoal inteligente no Telegram**

---

## Indice

1. [O que eh o Second Brain?](#1-o-que-eh-o-second-brain)
2. [Primeiros Passos](#2-primeiros-passos)
3. [Como Capturar Informacoes](#3-como-capturar-informacoes)
4. [Como o Sistema Organiza Tudo](#4-como-o-sistema-organiza-tudo)
5. [Comandos do Telegram](#5-comandos-do-telegram)
6. [Usando o Jarbas (Criacao de Conteudo)](#6-usando-o-jarbas-criacao-de-conteudo)
7. [Usando a Marta (Gestao de Equipe)](#7-usando-a-marta-gestao-de-equipe)
8. [O Painel de Controle (Dashboard)](#8-o-painel-de-controle-dashboard)
9. [Mensagens Automaticas](#9-mensagens-automaticas)
10. [Dicas e Boas Praticas](#10-dicas-e-boas-praticas)
11. [Perguntas Frequentes](#11-perguntas-frequentes)

---

## 1. O que eh o Second Brain?

O Second Brain eh como ter um **assistente executivo que nunca esquece nada**. Voce manda qualquer informacao pelo Telegram - um texto, um audio, uma foto, um PDF - e ele automaticamente:

- **Entende** o que voce enviou (inclusive transcreve audios e le PDFs)
- **Organiza** por categoria e prioridade
- **Sugere** o proximo passo e quem eh o responsavel
- **Lembra** voce do que precisa ser feito
- **Cobra** quando algo esta atrasado

Alem disso, o sistema conta com dois assistentes especializados:

- **Jarbas**: seu ghostwriter pessoal que escreve posts e artigos para LinkedIn
- **Marta**: sua chief of staff virtual que ajuda a gerenciar sua equipe

Pense nele como uma extensao da sua memoria: voce so precisa capturar, e o sistema cuida de organizar, priorizar e cobrar.

---

## 2. Primeiros Passos

### 2.1 Acessando o Bot no Telegram

1. Abra o Telegram
2. Procure pelo nome do seu bot (configurado pelo administrador)
3. Clique em **Iniciar** ou envie `/start`
4. Pronto! Voce ja pode comecar a enviar informacoes

### 2.2 Acessando o Painel de Controle

1. Abra o navegador
2. Acesse o endereco do seu servidor (exemplo: `http://seu-servidor:8080`)
3. Voce vera o painel com todas as suas informacoes organizadas

### 2.3 Primeira Captura

Envie qualquer mensagem pelo Telegram. Pode ser algo simples como:

> "Preciso ligar para o Joao sobre o projeto da nova loja ate sexta"

O sistema vai responder com algo assim:

> **Nova acao criada**
> Categoria: Negocios
> Prioridade: ALTA
> Proximo passo: Ligar para o Joao sobre o projeto da nova loja
> Prazo: sexta-feira
> Responsavel: Joao

---

## 3. Como Capturar Informacoes

O Second Brain aceita **qualquer tipo de conteudo** pelo Telegram:

### 3.1 Texto

Simplesmente digite e envie. O sistema entende portugues naturalmente.

**Exemplos:**
- "Reuniao com equipe de marketing amanha as 14h para discutir campanha de natal"
- "Ideias para o novo produto: versao mobile, integracao com pagamentos, dashboard para clientes"
- "Lembrar de renovar o contrato com o fornecedor ate dia 15"

### 3.2 Audio

Grave um audio no Telegram normalmente. O sistema vai:
1. Transcrever o audio automaticamente
2. Entender o conteudo
3. Organizar como qualquer outra captura

**Dica:** Audio eh otimo para quando voce esta andando, dirigindo ou simplesmente quer ser mais rapido. Fale naturalmente - o sistema entende giriass, pausas e correcoes.

### 3.3 Imagem

Envie uma foto pelo Telegram. O sistema usa inteligencia artificial para:
1. Descrever o que esta na imagem
2. Extrair informacoes relevantes
3. Classificar e organizar

**Exemplos de uso:**
- Foto de um quadro branco com anotacoes de reuniao
- Print de tela com informacoes importantes
- Foto de um cartao de visita
- Foto de um documento

**Dica:** Voce pode adicionar uma legenda na foto para dar contexto extra. Exemplo: envie a foto do quadro branco com a legenda "Plano de acao da reuniao de segunda".

### 3.4 PDF

Envie um arquivo PDF pelo Telegram. O sistema:
1. Extrai todo o texto do documento
2. Cria um resumo
3. Classifica e organiza

**Exemplos de uso:**
- Relatorios
- Propostas comerciais
- Contratos
- Artigos e pesquisas

### 3.5 Outros Arquivos

Voce pode enviar qualquer tipo de arquivo. O sistema armazena o arquivo e cria um registro para referencia futura.

---

## 4. Como o Sistema Organiza Tudo

### 4.1 Categorias

O sistema classifica automaticamente cada captura em categorias. Algumas categorias ja vem prontas:
- **Financeiro** - assuntos de dinheiro, orcamentos, investimentos
- **Saude** - consultas, exames, bem-estar
- **Negocios** - projetos, clientes, vendas, parcerias
- **Estudos** - cursos, livros, aprendizados

O sistema tambem **cria categorias novas** automaticamente quando identifica um assunto que nao se encaixa nas existentes.

### 4.2 Prioridades

Cada item recebe uma prioridade automatica:

| Prioridade | Significado |
|-----------|------------|
| **ALTA** | Urgente, precisa de atencao imediata |
| **MEDIA** | Importante, mas pode esperar um pouco |
| **BAIXA** | Para quando tiver tempo |

O sistema infere a prioridade pelo conteudo. Por exemplo: "urgente", "ate amanha", "critico" tendem a receber prioridade ALTA.

**Itens atrasados sao automaticamente promovidos para prioridade ALTA.**

### 4.3 Acoes Sugeridas

Para cada captura, o sistema sugere uma acao:

| Acao | Significado |
|------|------------|
| **Criar Tarefa** | Algo que precisa ser feito |
| **Criar Projeto** | Algo mais complexo, com multiplas etapas |
| **Guardar Referencia** | Informacao util para consultar depois |
| **Fazer Follow-up** | Precisa acompanhar com alguem |
| **Nenhuma** | Apenas armazenado para referencia |

### 4.4 Quando o Sistema Tem Duvida

Se o sistema nao tem certeza se a sua mensagem eh um complemento de algo que voce ja enviou antes ou algo completamente novo, ele pergunta:

> "Essa mensagem parece estar relacionada ao card #42 (Projeto nova loja). Eh um complemento desse assunto ou algo novo?"
> - Responda `complemento` para adicionar ao card existente
> - Responda `novo` para criar um card separado

Basta responder com uma dessas palavras e o sistema segue em frente.

### 4.5 Pastas de Organizacao (PARA)

Nos bastidores, o sistema organiza tudo em pastas seguindo o metodo PARA:

- **Projetos**: coisas com prazo e resultado definido
- **Areas**: responsabilidades continuas (saude, financas, carreira)
- **Recursos**: materiais de referencia (artigos, templates, contatos)
- **Pesquisa**: investigacoes e estudos em andamento
- **Arquivo**: coisas finalizadas ou descartadas

Voce nao precisa se preocupar com isso - o sistema decide sozinho onde colocar cada coisa.

---

## 5. Comandos do Telegram

Voce pode usar comandos especiais no Telegram para acoes rapidas:

### Lista de Comandos

| Comando | O que faz | Exemplo |
|---------|-----------|---------|
| `/start` | Inicia o bot e mostra boas-vindas | `/start` |
| `/help` | Mostra ajuda | `/help` |
| `/done <numero>` | Marca um item como concluido | `/done 42` |
| `/owner <numero> <nome>` | Define quem eh responsavel | `/owner 42 Joao` |
| `/prioridades` | Mostra lista de itens abertos por prioridade | `/prioridades` |
| `/weekly` | Gera relatorio semanal sob demanda | `/weekly` |
| `/snooze <numero> <dias>` | Adia um item por N dias | `/snooze 42 3` |

### Exemplos Praticos

**Concluir uma tarefa:**
```
/done 42
```
> Item #42 marcado como concluido!

**Definir responsavel:**
```
/owner 42 Maria
```
> Responsavel do item #42 atualizado para Maria.

**Ver o que esta pendente:**
```
/prioridades
```
> Mostra uma lista organizada por prioridade de tudo que esta aberto.

**Adiar algo:**
```
/snooze 42 5
```
> Item #42 adiado por 5 dias. Ele reaparecera no dia X.

---

## 6. Usando o Jarbas (Criacao de Conteudo)

O Jarbas eh seu escritor fantasma pessoal. Ele pesquisa, escreve e formata posts e artigos para LinkedIn.

### 6.1 Como Pedir um Post

Basta comecar a mensagem com "jarbas" seguido do que voce quer:

**Exemplos:**
- "jarbas escreve um post sobre inteligencia artificial na gestao de pessoas"
- "jarbas cria um artigo sobre lideranca em tempos de mudanca"
- "jarbas post sobre as tendencias de tecnologia para 2026"

### 6.2 O que o Jarbas Faz

Quando voce pede um post ou artigo, o Jarbas:

1. **Pesquisa** o assunto na internet para trazer dados atualizados
2. **Cria opcoes de abertura** (hooks) para voce escolher
3. **Escreve o rascunho** completo com base na pesquisa e no seu estilo
4. **Gera hashtags** relevantes
5. **Envia** o rascunho pelo Telegram

### 6.3 Post vs Artigo

- **Post**: texto curto para o feed do LinkedIn (ate ~1300 caracteres)
- **Artigo**: texto longo e aprofundado (2000+ palavras)

O Jarbas identifica automaticamente pelo contexto, mas voce pode ser explicito: "jarbas escreve um **artigo**" ou "jarbas faz um **post**".

### 6.4 Personalizacao

O Jarbas **aprende seu estilo** ao longo do tempo. Quando voce edita um rascunho e salva a versao final pelo painel de controle, o sistema analisa as mudancas que voce fez e ajusta as futuras geracoes para ficar mais parecido com o seu jeito de escrever.

### 6.5 Vendo e Editando no Painel

No painel de controle, clique na aba **Jarbas** para ver:
- Todos os rascunhos gerados
- Pesquisas realizadas
- Opcao de salvar versao final (que alimenta o aprendizado de estilo)

---

## 7. Usando a Marta (Gestao de Equipe)

A Marta eh sua chief of staff virtual. Ela ajuda a gerenciar pessoas, reunioes, compromissos e comunicacoes da sua equipe.

### 7.1 Cadastrando Pessoas

Antes de usar a Marta, cadastre as pessoas da sua equipe:

```
marta adiciona Joao Silva como desenvolvedor senior, email joao@empresa.com
```

Voce tambem pode:
```
marta joao agora eh tech lead
marta atualiza email do joao para joao.silva@empresa.com
```

### 7.2 Briefing Pre-Reuniao

Antes de uma reuniao 1:1, peca um briefing:

```
marta briefing do joao
```

A Marta vai gerar um resumo com:
- Itens pendentes relacionados ao Joao
- Compromissos abertos (dele e seus)
- Historico recente de interacoes
- Pontos para discutir
- Saude do relacionamento profissional

### 7.3 Notas de Reuniao

Apos uma reuniao, envie suas anotacoes:

```
marta notas da reuniao com joao: discutimos o projeto X, ele vai entregar a proposta ate sexta. Decidimos adiar o lancamento para marco. Preciso enviar o orcamento revisado.
```

A Marta automaticamente:
- Extrai **decisoes** tomadas
- Identifica **compromissos** (quem se comprometeu com o que)
- Atualiza a data do ultimo 1:1
- Armazena o contexto para futuras reunioes

Voce tambem pode enviar um **audio** ou **PDF** com as notas:
```
marta notas da reuniao com joao
[anexe o audio ou PDF]
```

### 7.4 Status da Equipe

Peca uma visao geral:

```
marta status da equipe
```

A Marta mostra:
- Panorama de cada pessoa (itens pendentes, compromissos)
- Saude do relacionamento (baseado em frequencia de contato)
- Alertas (reunioes atrasadas, compromissos vencidos)
- Sugestoes de acao

### 7.5 Rascunho de Email

Peca para a Marta escrever um email:

```
marta escreve email pro joao sobre o atraso na entrega do relatorio
```

Ela gera um rascunho que voce pode revisar e enviar pelo painel de controle.

### 7.6 Lembretes

Agende lembretes relacionados a pessoas:

```
marta lembra de perguntar pro joao sobre o projeto na segunda
marta lembrete: revisar metas da equipe toda primeira segunda do mes
```

### 7.7 Agendar Reunioes

Se voce tem o Google Calendar configurado:

```
marta agenda 1:1 com joao para quinta as 14h
```

### 7.8 Reflexao Estrategica

Para momentos de reflexao:

```
marta reflexao sobre como melhorar a comunicacao da equipe
```

A Marta gera uma analise com base no historico de interacoes, decisoes e padroes que observou.

### 7.9 Conversas com a Marta

A Marta mantem o contexto durante uma conversa. Voce pode enviar multiplas mensagens de continuacao sem precisar repetir "marta" toda vez. Por exemplo:

```
Voce: marta briefing do joao
Marta: [gera briefing]
Voce: adiciona tambem o assunto do orcamento
Marta: [atualiza briefing]
Voce: perfeito, agora manda como email
Marta: [gera email baseado no briefing]
```

### 7.10 Vendo no Painel

No painel de controle, clique na aba **Marta** para ver:
- Lista de pessoas cadastradas
- Briefings, notas e emails gerados
- Compromissos pendentes
- Lembretes agendados
- Saude do relacionamento com cada pessoa

---

## 8. O Painel de Controle (Dashboard)

O painel de controle eh acessado pelo navegador e oferece uma visao completa do seu Second Brain.

### 8.1 Visao Geral

Ao abrir o painel, voce ve:

- **Barra de busca** no topo (busca inteligente por conteudo)
- **Estatisticas** (total de itens, projetos, categorias, alertas)
- **Quadro Kanban** com 4 colunas

### 8.2 Quadro Kanban

O quadro organiza seus itens em 4 colunas:

| Coluna | O que tem |
|--------|-----------|
| **A Processar** | Itens recem-capturados aguardando organizacao |
| **Abertos** | Acoes que precisam ser feitas |
| **Resolvidos** | Coisas que voce ja concluiu |
| **Eliminados** | Coisas que voce descartou |

### 8.3 Trabalhando com Cards

**Clicar em um card** abre os detalhes completos, onde voce pode:
- Editar o resumo
- Mudar a prioridade (ALTA, MEDIA, BAIXA)
- Definir ou alterar o prazo
- Definir o proximo passo
- Definir o responsavel
- Mudar a categoria
- Marcar como concluido ou eliminado
- Reabrir um item concluido ou eliminado

### 8.4 Filtros

Voce pode filtrar os cards por:
- **Prioridade**: ALTA, MEDIA, BAIXA ou todas
- **Categoria**: qualquer categoria do sistema

### 8.5 Busca

A barra de busca usa **busca inteligente** (semantica). Isso significa que voce nao precisa lembrar as palavras exatas - o sistema entende o significado.

**Exemplo:** se voce buscar "reunioes com clientes", o sistema encontra itens que falam sobre "encontro com parceiros", "call com prospects", etc.

### 8.6 Abas

O painel tem tres abas:
- **Second Brain**: o quadro principal com todos os seus itens
- **Jarbas**: posts e artigos gerados pelo ghostwriter
- **Marta**: briefings, emails e dados da gestao de equipe

### 8.7 Itens da Fila de Entrada

Itens na coluna "A Processar" podem ser classificados manualmente:
- **Acionavel**: transforma em acao (com prioridade e proximo passo)
- **Referencia**: armazena como material de consulta
- **Descartar**: remove da fila

---

## 9. Mensagens Automaticas

O Second Brain nao espera voce perguntar - ele se comunica proativamente.

### 9.1 Check-in Diario

Todo dia de manha (horario configuravel, padrao 9h), voce recebe uma mensagem com:

- **Foco do dia**: os itens mais importantes que precisam da sua atencao
- **Itens atrasados**: coisas que passaram do prazo
- **Itens estagnados**: coisas abertas ha mais de 5 dias sem atividade
- **Agenda do dia**: reunioes e eventos (se Google Calendar estiver conectado)
- **Status da equipe**: resumo de cada pessoa (se usar a Marta)
- **Rascunhos pendentes**: posts do Jarbas aguardando revisao
- **Compromissos vencidos**: promessas que passaram do prazo

### 9.2 Relatorio Semanal

Uma vez por semana (padrao: segunda-feira de manha), voce recebe um resumo:

- Quantos itens foram capturados na semana
- Quantos foram concluidos
- O que esta atrasado
- Prioridades para a proxima semana
- Status dos compromissos

Voce tambem pode pedir o relatorio a qualquer momento com `/weekly`.

### 9.3 Lembretes

Lembretes agendados sao enviados automaticamente na hora programada. Podem ser:
- Unicos ("lembra amanha de ligar pro joao")
- Recorrentes ("toda segunda lembra de revisar as metas")

### 9.4 Alertas de Reuniao

Se o Google Calendar estiver conectado:
- **15 minutos antes** de uma reuniao 1:1: voce recebe um briefing automatico
- **10 minutos depois** da reuniao: o sistema pede suas notas

### 9.5 Cobranca de Responsavel

Quando voce cria um card sem definir quem eh o responsavel, o sistema cobra:
> "Quem eh o responsavel por essa acao? Use `/owner 42 Nome` para definir."

---

## 10. Dicas e Boas Praticas

### 10.1 Capture Primeiro, Organize Depois

Nao se preocupe em ser perfeito na hora de enviar. O sistema organiza para voce. Quanto mais voce capturar, mais util o sistema fica.

### 10.2 Use Audio para Ser Mais Rapido

Audio eh o formato mais rapido de captura. Fale naturalmente, como se estivesse explicando para alguem. O sistema transcreve e entende tudo.

### 10.3 Diga o "Quem" e o "Quando"

Suas capturas ficam mais uteis quando incluem:
- **Quem** eh responsavel ("Joao precisa entregar...")
- **Quando** precisa acontecer ("...ate sexta")
- **Qual** o proximo passo ("...revisar a proposta primeiro")

### 10.4 Revise o Check-in Diario

O check-in da manha eh o melhor momento para:
- Ver o que eh prioridade
- Resolver itens atrasados
- Replanejar o dia

### 10.5 Mantenha o Quadro Limpo

Visite o painel periodicamente para:
- Concluir itens que ja foram feitos
- Eliminar itens que nao fazem mais sentido
- Ajustar prioridades quando necessario

### 10.6 Ajude o Sistema a Aprender

Quando o sistema pergunta se uma mensagem eh complemento ou algo novo, responda sempre. Isso melhora a precisao com o tempo.

### 10.7 Use Legendas em Midias

Ao enviar fotos, audios ou PDFs, adicione uma legenda explicando o contexto. Isso ajuda o sistema a classificar melhor.

### 10.8 Personalize o Jarbas

Depois que o Jarbas gerar um rascunho, edite-o e salve a versao final pelo painel. O sistema aprende seu estilo e melhora nas proximas vezes.

### 10.9 Cadastre Sua Equipe na Marta

Para tirar o maximo proveito da Marta, cadastre todas as pessoas com quem voce trabalha, incluindo:
- Nome completo e apelidos
- Cargo/funcao
- Email
- Tipo de relacao (subordinado direto, par, stakeholder)
- Frequencia de 1:1 (semanal, quinzenal, mensal)

---

## 11. Perguntas Frequentes

### "Posso usar o sistema so pelo Telegram?"
Sim! O Telegram eh o canal principal. O painel de controle eh opcional - serve para ter uma visao mais ampla e fazer edicoes mais detalhadas.

### "O sistema funciona em grupo ou so em conversa privada?"
Funciona em ambos, mas o mais comum eh usar em conversa privada com o bot.

### "Se eu enviar algo errado, posso corrigir?"
Sim! Use o painel de controle para editar qualquer campo: resumo, prioridade, categoria, prazo, responsavel, etc. Voce tambem pode eliminar o item e criar outro.

### "Como funciona a busca inteligente?"
A busca entende o significado das palavras, nao apenas correspondencia exata. Se voce buscar "problemas com fornecedores", vai encontrar itens que falam sobre "reclamacao do parceiro X" ou "atraso na entrega do fornecedor Y".

### "Quantas mensagens posso enviar por dia?"
Nao ha limite. Envie quantas quiser - o sistema processa tudo.

### "O sistema entende outros idiomas alem de portugues?"
O sistema foi otimizado para **portugues brasileiro**, mas entende outras linguas tambem. As respostas serao sempre em portugues.

### "Minhas informacoes ficam seguras?"
Sim. Seus dados ficam armazenados no seu servidor privado (banco de dados PostgreSQL + arquivos locais). Nada eh compartilhado com terceiros, exceto as chamadas necessarias para os servicos de IA (OpenAI/Anthropic) para processamento.

### "E se a internet cair ou o servico de IA ficar fora?"
O sistema tem mecanismos de fallback. Se a IA estiver indisponivel, ele usa regras basicas de classificacao (por palavras-chave) para nao perder nenhuma captura. Quando a IA voltar, tudo continua normalmente.

### "Posso usar o Jarbas e a Marta ao mesmo tempo?"
Sim! Sao agentes independentes. Voce pode pedir um post ao Jarbas e logo depois pedir um briefing para a Marta. Cada um trabalha no seu escopo.

### "Como o sistema sabe se estou falando com o Jarbas, com a Marta, ou so capturando algo?"
Simples: se sua mensagem comeca com "jarbas", vai para o Jarbas. Se comeca com "marta", vai para a Marta. Qualquer outra coisa eh processada pelo pipeline normal de captura.

### "O check-in diario eh obrigatorio?"
Nao, mas eh muito recomendado. Voce pode configurar o horario que preferir. O sistema envia automaticamente - basta ler e agir.

### "Posso adiar algo que nao quero lidar agora?"
Sim! Use o comando `/snooze 42 5` para adiar o item #42 por 5 dias. Ele desaparece temporariamente e volta na data programada.

### "Como vejo o numero (ID) de um card?"
O sistema mostra o ID na mensagem de confirmacao quando cria um card. No painel de controle, o ID aparece em cada card do quadro Kanban.

### "Posso exportar meus dados?"
Sim. Todos os seus dados estao disponiveis de duas formas:
1. **Banco de dados**: PostgreSQL acessivel por qualquer cliente SQL
2. **Arquivos Markdown**: na pasta `storage/SecondBrain/`, organizados em pastas legíveis

---

*Documento criado em 2026-02-28. Para duvidas tecnicas ou suporte, consulte o documento ARQUITETURA.md.*
