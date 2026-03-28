# Banco de Talentos

Sistema local para gerenciamento de currículos e candidatos. O backend em Python extrai dados automaticamente de PDFs (nome, e-mail, telefone, cargo, área, nível) usando spaCy e regex. O frontend é um arquivo HTML que se comunica com o backend via API REST.

## Estrutura do projeto

```
projeto/
├── app.py        ← backend Flask (API + parser de PDF)
├── index.html    ← frontend (abre direto no navegador)
├── style.css     ← estilos do frontend
└── talentos.db   ← banco SQLite (criado automaticamente)
```

## Requisitos

- Python 3.8+
- Navegador moderno (Chrome, Firefox, Edge)

## Instalação

```bash
pip install flask flask-cors pdfplumber spacy
python -m spacy download pt_core_news_sm
python -m spacy download en_core_web_sm
```

## Como usar

**1. Iniciar o backend**
```bash
python app.py
```
O servidor sobe em `http://localhost:5000`. Deixe o terminal aberto.

**2. Abrir o frontend**

Abra o arquivo `index.html` diretamente no navegador (duplo clique ou via Live Server no VS Code). O indicador no menu lateral mostra se o servidor está online.

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Verifica se o servidor está online |
| `POST` | `/parse` | Envia PDF e retorna dados extraídos |
| `GET` | `/candidates` | Lista todos os candidatos |
| `POST` | `/candidates` | Cadastra novo candidato |
| `PUT` | `/candidates/<id>` | Atualiza status do candidato |
| `DELETE` | `/candidates/<id>` | Remove candidato |

### POST /parse

Recebe um arquivo PDF via `multipart/form-data` (campo `file`) e retorna:

```json
{
  "nome": "Ana Paula Silva",
  "email": "ana@email.com",
  "telefone": "(41) 99999-0000",
  "cargo": "Desenvolvedora Frontend",
  "area": "Tecnologia",
  "nivel": "Pleno",
  "resumo": "Profissional com experiência em React e TypeScript..."
}
```

### POST /candidates

```json
{
  "nome": "Ana Paula Silva",
  "cargo": "Desenvolvedora Frontend",
  "area": "Tecnologia",
  "nivel": "Pleno",
  "tel": "(41) 99999-0000",
  "email": "ana@email.com",
  "status": "Novo",
  "data": "2026-03-28",
  "obs": "Observações do recrutador"
}
```

Campos obrigatórios: `nome`, `cargo`.

## Funcionalidades

- Upload de PDF com extração automática de dados via spaCy + regex
- Cadastro manual de candidatos
- Busca e filtros por nome, cargo, área e status
- Atualização de status (Novo, Em análise, Aprovado, Descartado)
- Visão geral com gráficos de barras por status e área
- Exportação para CSV
- Dados persistidos em SQLite local (`talentos.db`)

## Detecção automática

O parser identifica:

- **Nome** — via entidade `PER` do spaCy, com fallback por regex nas primeiras linhas
- **E-mail** — regex padrão RFC
- **Telefone** — padrões brasileiros `(DD) NNNNN-NNNN` e `+55`
- **Cargo** — busca por palavras-chave nas primeiras 15 linhas
- **Área** — pontuação por palavras-chave em 7 categorias (Tecnologia, Marketing, Vendas, RH, Financeiro, Operações, Administrativo)
- **Nível** — palavras-chave (Júnior, Pleno, Sênior, etc.) ou heurística por anos de experiência
- **Resumo** — extrai seção "Resumo/Perfil" do currículo ou gera fallback com cargo e área ca9cecb (first commit)
