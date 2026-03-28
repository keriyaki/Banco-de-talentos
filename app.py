"""
Backend Flask para o Banco de Talentos
Persistência em SQLite + parser melhorado para nome e telefone

Instalação:
    pip install flask flask-cors pdfplumber spacy
    python -m spacy download pt_core_news_sm
    python -m spacy download en_core_web_sm

Uso:
    python app.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pdfplumber
import spacy
import re
import io
import os
import sqlite3
from datetime import date

app = Flask(__name__)
CORS(app)

DB_PATH = os.path.join(os.path.dirname(__file__), "talentos.db")

# ─── Banco de dados ────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS candidates (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                nome    TEXT    NOT NULL,
                cargo   TEXT    NOT NULL,
                area    TEXT,
                nivel   TEXT,
                tel     TEXT,
                email   TEXT,
                status  TEXT    DEFAULT 'Novo',
                data    TEXT,
                obs     TEXT,
                created_at TEXT DEFAULT (date('now'))
            )
        """)
        conn.commit()

init_db()

# ─── Carrega modelos spaCy ─────────────────────────────────────────────────────
nlp = None
for model in ["pt_core_news_sm", "en_core_web_sm"]:
    try:
        nlp = spacy.load(model)
        print(f"Modelo spaCy carregado: {model}")
        break
    except OSError:
        continue

if nlp is None:
    print("AVISO: Nenhum modelo spaCy encontrado. Usando apenas regex.")


# ─── Extração de texto do PDF ──────────────────────────────────────────────────
def extract_text_from_pdf(pdf_bytes):
    text = ""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        raise ValueError(f"Erro ao ler PDF: {str(e)}")
    return text.strip()


# ─── Extração de e-mail ────────────────────────────────────────────────────────
def extract_email(text):
    pattern = r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
    match = re.search(pattern, text)
    return match.group(0) if match else ""


# ─── Extração de telefone (melhorada) ─────────────────────────────────────────
def extract_phone(text):
    """
    Cobre os principais formatos brasileiros:
      (41) 99999-0000   (41)99999-0000   41 99999-0000
      +55 41 99999-0000  41999990000
    Prefixos opcionais: Tel, Cel, Fone, Telefone, Whatsapp, Contato
    """
    text_norm = re.sub(r"[ \t]+", " ", text)
    prefix = r"(?:tel(?:efone)?|cel(?:ular)?|fone|whatsapp|zap|contato)\s*[:\-]?\s*"

    patterns = [
        # +55 (41) 99999-0000  ou  +55 41 99999-0000
        rf"(?:{prefix})?\+55\s*\(?(\d{{2}})\)?\s*(\d{{4,5}})[\-\s]?(\d{{4}})",
        # (41) 99999-0000  ou  (41)99999-0000
        rf"(?:{prefix})?\((\d{{2}})\)\s*(\d{{4,5}})[\-\s]?(\d{{4}})",
        # 41 99999-0000  ou  41 9999-0000
        rf"(?:{prefix})?(\d{{2}})\s(\d{{4,5}})[\-\s](\d{{4}})",
        # 41999990000  (11 dígitos colados)
        rf"(?:{prefix})?(\d{{2}})(\d{{4,5}})(\d{{4}})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text_norm, re.IGNORECASE)
        if match:
            ddd, part1, part2 = match.group(1), match.group(2), match.group(3)
            return f"({ddd}) {part1}-{part2}"

    return ""


# ─── Extração de nome (melhorada) ─────────────────────────────────────────────
def extract_name(text):
    """
    Estratégia em camadas:
    1. Rótulo explícito "Nome: ..." ou "Nome\n..."
    2. spaCy (entidade PER) nas primeiras linhas
    3. Fallback regex: primeira linha que parece nome próprio
    """
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    # --- Camada 1: rótulo explícito ---
    label_pattern = re.compile(
        r"^(?:nome\s+completo|nome|name)\s*[:\-]\s*(.+)$", re.IGNORECASE
    )
    for i, line in enumerate(lines[:20]):
        m = label_pattern.match(line)
        if m:
            candidate = m.group(1).strip()
            if _is_valid_name(candidate):
                return candidate
        # Rótulo sozinho, valor na próxima linha
        if re.match(r"^(?:nome\s+completo|nome|name)\s*$", line, re.IGNORECASE):
            if i + 1 < len(lines) and _is_valid_name(lines[i + 1]):
                return lines[i + 1]

    # --- Camada 2: spaCy ---
    if nlp is not None:
        try:
            first_block = "\n".join(lines[:10])
            doc = nlp(first_block)
            for ent in doc.ents:
                if ent.label_ == "PER":
                    candidate = ent.text.strip()
                    if _is_valid_name(candidate):
                        return candidate
        except Exception:
            pass

    # --- Camada 3: heurística regex ---
    SKIP_WORDS = {
        "linkedin", "github", "http", "@", "curricul", "resume", "curriculum",
        "cv ", "brasil", "curitiba", "são paulo", "rio de", "belo horizonte",
        "porto alegre", "rua ", "av.", "avenida", "tel", "cel", "fone", "email",
        "perfil", "profile", "objetivo", "summary", "sobre", "about",
    }
    for line in lines[:12]:
        lower = line.lower()
        if any(k in lower for k in SKIP_WORDS):
            continue
        if re.search(r"[@\d/\\|]", line):
            continue
        words = line.split()
        if 2 <= len(words) <= 5 and all(
            re.match(r"^[A-ZÀ-Úa-zà-ú][A-ZÀ-Úa-zà-ú\'\-]*$", w) for w in words
        ):
            long_words = [w for w in words if len(w) >= 2]
            if len(long_words) >= 2:
                return line

    return ""


def _is_valid_name(text):
    if not text or len(text) < 4:
        return False
    if re.search(r"[@\d/\\|]", text):
        return False
    words = text.split()
    if not (2 <= len(words) <= 6):
        return False
    return all(re.match(r"^[A-ZÀ-Úa-zà-ú][A-ZÀ-Úa-zà-ú\'\-]*$", w) for w in words)


# ─── Demais extrações ──────────────────────────────────────────────────────────
def extract_cargo(text):
    cargo_keywords = [
        "desenvolvedor", "developer", "analista", "analyst", "engenheiro", "engineer",
        "gerente", "manager", "coordenador", "coordinator", "diretor", "director",
        "designer", "arquiteto", "architect", "consultor", "consultant", "especialista",
        "specialist", "técnico", "technician", "assistente", "assistant", "estagiário",
        "intern", "estágio", "supervisor", "líder", "lead", "cientista", "scientist",
        "programador", "programmer", "fullstack", "frontend", "backend", "devops",
        "scrum", "agile", "product", "projeto", "dados", "data", "marketing",
        "vendas", "sales", "rh", "recursos humanos", "financeiro", "contabilidade",
        "administrativo", "suporte", "support", "operações",
    ]
    for line in text.split("\n")[:15]:
        line_clean = line.strip()
        if not line_clean:
            continue
        lower = line_clean.lower()
        for kw in cargo_keywords:
            if kw in lower:
                return line_clean[:80]
    return ""


def detect_area(text):
    lower = text.lower()
    area_map = {
        "Tecnologia": ["python", "javascript", "java", "c++", "sql", "docker", "git",
                       "react", "node", "api", "software", "desenvolvedor", "developer",
                       "programador", "dados", "data", "machine learning", "ia ", "ai ",
                       "frontend", "backend", "fullstack", "devops", "cloud", "aws",
                       "linux", "banco de dados", "database"],
        "Marketing":  ["marketing", "seo", "social media", "campanha", "branding",
                       "publicidade", "propaganda", "conteúdo", "content", "mídia"],
        "Vendas":     ["vendas", "sales", "comercial", "cliente", "crm", "negociação",
                       "prospecção", "lead", "funil"],
        "RH":         ["recursos humanos", "recrutamento", "seleção", "rh ", " rh", "talent",
                       "treinamento", "onboarding", "folha de pagamento", "benefícios"],
        "Financeiro": ["financeiro", "contabilidade", "controladoria", "fiscal",
                       "tributário", "balanço", "fluxo de caixa"],
        "Operações":  ["operações", "logística", "supply chain", "estoque", "produção",
                       "qualidade", "processo", "lean", "six sigma"],
        "Administrativo": ["administrativo", "secretaria", "assistente administrativo",
                           "gestão", "documentação", "arquivo"],
    }
    scores = {area: 0 for area in area_map}
    for area, keywords in area_map.items():
        for kw in keywords:
            if kw in lower:
                scores[area] += 1
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "Outro"


def detect_nivel(text):
    lower = text.lower()
    if any(k in lower for k in ["estagiário", "estágio", "intern", "trainee"]):
        return "Estagiário"
    if any(k in lower for k in ["diretor", "direção", "vp ", "vice-presidente", "c-level", "cto", "ceo", "cfo"]):
        return "Gerencial"
    if any(k in lower for k in ["especialista", "specialist", "arquiteto", "architect", "principal"]):
        return "Especialista"
    if any(k in lower for k in ["sênior", "senior", "sr.", " sr "]):
        return "Sênior"
    if any(k in lower for k in ["pleno", "mid-level", "mid level", "intermediário"]):
        return "Pleno"
    if any(k in lower for k in ["júnior", "junior", "jr.", " jr "]):
        return "Júnior"
    anos = re.findall(r"(\d+)\s*anos?\s*de\s*experi", lower)
    if anos:
        n = int(anos[0])
        if n <= 1:  return "Júnior"
        if n <= 3:  return "Pleno"
        if n <= 6:  return "Sênior"
        return "Especialista"
    return ""


def generate_summary(text, nome, cargo, area):
    lines = text.split("\n")
    summary_keywords = ["resumo", "objetivo", "perfil", "sobre mim", "summary", "profile", "about"]
    in_section = False
    summary_lines = []
    for line in lines:
        lower = line.lower().strip()
        if any(k in lower for k in summary_keywords) and len(lower) < 30:
            in_section = True
            continue
        if in_section:
            if line.strip() == "":
                if summary_lines:
                    break
                continue
            if len(line.strip()) < 25 and line.strip().isupper():
                break
            summary_lines.append(line.strip())
            if len(summary_lines) >= 4:
                break
    if summary_lines:
        return " ".join(summary_lines)[:400]
    parts = []
    if cargo:
        parts.append(f"Profissional na área de {cargo}.")
    if area and area != "Outro":
        parts.append(f"Área de atuação: {area}.")
    return " ".join(parts) if parts else ""


# ─── Rotas CRUD candidatos ─────────────────────────────────────────────────────
@app.route("/candidates", methods=["GET"])
def list_candidates():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM candidates ORDER BY id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/candidates", methods=["POST"])
def create_candidate():
    data = request.get_json()
    if not data or not data.get("nome") or not data.get("cargo"):
        return jsonify({"error": "nome e cargo são obrigatórios"}), 400
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO candidates (nome, cargo, area, nivel, tel, email, status, data, obs)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (data.get("nome"), data.get("cargo"), data.get("area"), data.get("nivel"),
             data.get("tel"), data.get("email"), data.get("status", "Novo"),
             data.get("data", str(date.today())), data.get("obs")),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM candidates WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route("/candidates/<int:cid>", methods=["PUT"])
def update_candidate(cid):
    data = request.get_json()
    if not data:
        return jsonify({"error": "body vazio"}), 400
    fields = ["nome", "cargo", "area", "nivel", "tel", "email", "status", "data", "obs"]
    updates = {f: data[f] for f in fields if f in data}
    if not updates:
        return jsonify({"error": "nenhum campo para atualizar"}), 400
    set_clause = ", ".join(f"{k}=?" for k in updates)
    with get_db() as conn:
        conn.execute(
            f"UPDATE candidates SET {set_clause} WHERE id=?",
            (*updates.values(), cid),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM candidates WHERE id=?", (cid,)).fetchone()
    if row is None:
        return jsonify({"error": "candidato não encontrado"}), 404
    return jsonify(dict(row))


@app.route("/candidates/<int:cid>", methods=["DELETE"])
def delete_candidate(cid):
    with get_db() as conn:
        conn.execute("DELETE FROM candidates WHERE id=?", (cid,))
        conn.commit()
    return jsonify({"ok": True})


# ─── Rota parse PDF ────────────────────────────────────────────────────────────
@app.route("/parse", methods=["POST"])
def parse_resume():
    if "file" not in request.files:
        return jsonify({"error": "Nenhum arquivo enviado"}), 400
    file = request.files["file"]
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Apenas arquivos PDF são suportados"}), 400
    try:
        pdf_bytes = file.read()
        text = extract_text_from_pdf(pdf_bytes)
        if not text:
            return jsonify({"error": "Não foi possível extrair texto do PDF"}), 422

        nome     = extract_name(text)
        email    = extract_email(text)
        telefone = extract_phone(text)
        cargo    = extract_cargo(text)
        area     = detect_area(text)
        nivel    = detect_nivel(text)
        resumo   = generate_summary(text, nome, cargo, area)

        return jsonify({
            "nome": nome, "email": email, "telefone": telefone,
            "cargo": cargo, "area": area, "nivel": nivel, "resumo": resumo,
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 422
    except Exception as e:
        return jsonify({"error": f"Erro interno: {str(e)}"}), 500


# ─── Health check ──────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "spacy_model": nlp.meta["name"] if nlp else None,
        "db": DB_PATH,
    })


if __name__ == "__main__":
    print("\n=== Banco de Talentos — Backend ===")
    print(f"Banco de dados: {DB_PATH}")
    print("API em: http://localhost:5000")
    print("Pressione Ctrl+C para parar\n")
    app.run(debug=True, port=5000)
