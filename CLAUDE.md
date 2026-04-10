# Banco de Talentos

Sistema de recrutamento interno com backend Flask (Python) e frontend em HTML/CSS/JS puro. Permite cadastrar candidatos manualmente ou via upload de currículo em PDF, com extração automática de dados usando spaCy e regex.

## Arquitetura

```
projeto/
├── app.py        ← backend Flask (API REST + servidor de arquivos estáticos)
├── index.html    ← frontend completo (SPA vanilla JS)
├── style.css     ← estilos do frontend
├── talentos.db   ← banco SQLite criado automaticamente na primeira execução
└── requirements.txt
```

O frontend é uma SPA (Single Page Application) que se comunica com o backend via `fetch` para `http://localhost:5000`. Não há build step — tudo é servido diretamente pelo Flask.

## Como rodar

```bash
pip install flask flask-cors pdfplumber spacy
python -m spacy download pt_core_news_sm
python app.py
```

Acesse `http://localhost:5000` (ou pelo IP da máquina na rede local, ex: `http://192.168.1.81:5000`).

## Rotas da API

| Método | Rota                  | Descrição                        |
|--------|-----------------------|----------------------------------|
| GET    | `/`                   | Serve o `index.html`             |
| GET    | `/candidates`         | Lista todos os candidatos        |
| POST   | `/candidates`         | Cadastra novo candidato          |
| PUT    | `/candidates/<id>`    | Atualiza dados de um candidato   |
| DELETE | `/candidates/<id>`    | Remove um candidato              |
| POST   | `/parse`              | Faz parse de currículo em PDF    |
| GET    | `/health`             | Health check do servidor         |

## Extração de dados do PDF

O parser em `app.py` usa uma abordagem em camadas:

1. **Nome**: rótulo explícito ("Nome: ...") → spaCy (entidade `PER`) → heurística regex nas primeiras linhas
2. **E-mail**: regex simples
3. **Telefone**: regex cobrindo formatos brasileiros com DDD, com/sem `+55`, formatado ou colado
4. **Cargo**: busca por palavras-chave nas primeiras 15 linhas
5. **Área**: score por ocorrência de palavras-chave por categoria (Tecnologia, Marketing, RH, etc.)
6. **Nível**: palavras-chave explícitas ou estimativa pelos anos de experiência mencionados
7. **Resumo**: busca seção "Resumo/Perfil" no texto ou monta frase a partir de cargo e área

## Banco de dados

SQLite via `sqlite3` padrão do Python. Tabela única `candidates` com os campos: `id`, `nome`, `cargo`, `area`, `nivel`, `tel`, `email`, `status`, `data`, `obs`, `created_at`.

## Correção aplicada — bug do 404 na rota raiz

### O problema

Ao acessar `http://192.168.1.81:5000/`, o servidor retornava **404 Not Found**.

A causa raiz era dupla:

1. **Nenhuma rota `/` definida**: o Flask só registra rotas explicitamente declaradas com `@app.route`. Como não havia rota para `/`, qualquer acesso à raiz resultava em 404.

2. **`Flask(__name__)` sem configuração de estáticos**: a instância padrão do Flask serve arquivos estáticos apenas da subpasta `./static/`. Como o `index.html` e o `style.css` ficam na raiz do projeto (não dentro de `static/`), o Flask nem os enxergava.

O frontend estava sendo aberto diretamente como arquivo (`file://`) em vez de ser servido pelo servidor — funcionava localmente mas quebrava no acesso via IP da rede.

### A correção

Duas mudanças em `app.py`:

**1. Import de `send_from_directory`:**
```python
from flask import Flask, request, jsonify, send_from_directory
```

**2. Configuração do Flask e rota raiz:**
```python
# Antes:
app = Flask(__name__)

# Depois:
app = Flask(__name__, static_folder=".", static_url_path="")

@app.route("/")
def index():
    return send_from_directory(".", "index.html")
```

- `static_folder="."` diz ao Flask para servir arquivos estáticos a partir da pasta do projeto (onde `style.css` está).
- `static_url_path=""` remove o prefixo `/static` da URL, então `style.css` fica acessível em `/style.css` como o `index.html` espera.
- A rota `/` retorna o `index.html` explicitamente com `send_from_directory`.

Com isso, o Flask passou a ser o servidor completo — tanto da API quanto do frontend — e o acesso via IP da rede local funciona normalmente.
