"""Markdown-outline and structured content generation and editing engine
supporting Microsoft Word (.docx), PDF (.pdf), Excel (.xlsx / .csv), and PowerPoint (.pptx).
Provides surgical editing, text/table extraction, and CLI/IPC interfaces.
"""
import argparse
import csv
import html
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from pptx import Presentation

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table as PdfTable,
    TableStyle,
)
from reportlab.pdfgen import canvas

import pypdf

logger = logging.getLogger(__name__)

_TABLE_SEPARATOR_RE = re.compile(r'^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$')


# ─────────────────────────────────────────────────────────────────────────────
# 1. Numbered Canvas for PDF (Page X of Y)
# ─────────────────────────────────────────────────────────────────────────────
class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))

        # Footer divider and page number
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(40, 32, letter[0] - 40, 32)

        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(letter[0] - 40, 20, page_str)
        self.drawString(40, 20, "PRAGNA 1-A Document Intelligence")
        self.restoreState()


# ─────────────────────────────────────────────────────────────────────────────
# 2. String & Markdown Parsing Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _clean_subject_title(prompt):
    """Derive a clean, capitalized document title from a user prompt."""
    if not prompt:
        return "Comprehensive Document"
    text = prompt.strip()
    text = re.sub(
        r'^(?:please\s+)?(?:generate|create|make|write|draft|build|export|give\s+me)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:pdf|word\s+doc|docx|doc|excel\s+sheet|spreadsheet|xlsx|powerpoint|presentation|deck|pptx|document|report)?\s*(?:having|about|on|for|regarding|with|of)?\s*',
        '',
        text,
        flags=re.IGNORECASE,
    ).strip()
    text = re.sub(
        r'\s+(?:in|as|into)\s+(?:a\s+|an\s+)?(?:pdf|docx|word|excel|xlsx|pptx|powerpoint)$',
        '',
        text,
        flags=re.IGNORECASE,
    ).strip()
    if not text:
        text = prompt.strip()
    text = re.sub(r'[#*_`~]+', '', text).strip()
    words = text.split()
    if words:
        title = " ".join(
            w.capitalize()
            if w.lower() not in {'and', 'or', 'the', 'a', 'an', 'in', 'on', 'of', 'for', 'to', 'with', 'about'}
            or i == 0
            else w.lower()
            for i, w in enumerate(words)
        )
        return title[:100]
    return "Comprehensive Document"


def _sanitize_filename_component(text):
    """Turn arbitrary text into a short, filesystem-safe slug."""
    cleaned = re.sub(r'[^\w\s-]', '', text or '').strip().lower()
    cleaned = re.sub(r'[\s]+', '-', cleaned)
    return cleaned[:60] or 'document'


def _sanitize_sheet_name(name):
    cleaned = re.sub(r'[\[\]:*?/\\]', '', name or '').strip()
    return cleaned[:31] or "Sheet1"


def _generate_fallback_structure(prompt, language="en"):
    """Generate rich, multi-section fallback document structure when input is a short prompt."""
    title = _clean_subject_title(prompt)
    lower_prompt = prompt.lower()

    if any(k in lower_prompt for k in ['cat', 'feline', 'kitten', 'pet']):
        sections = [
            {
                "heading": "Executive Overview & Feline History",
                "bullets": [
                    "Cats (Felis catus) have shared a profound relationship with human civilization spanning over 9,500 years, beginning in the Fertile Crescent.",
                    "Ancient Egyptians venerated cats as symbols of grace and divine protection, associating them with the deities Bastet and Mafdet.",
                    "Through maritime trade routes and agricultural settlements, domestic cats spread across Asia, Europe, and the Americas as skilled pest controllers.",
                    "Today, cats are among the most popular companion animals globally, with hundreds of distinct breeds recognized worldwide.",
                ],
                "table": None,
            },
            {
                "heading": "Biological Characteristics & Sensory Capabilities",
                "bullets": [
                    "Exceptional nocturnal vision facilitated by a reflective tapetum lucidum behind the retina.",
                    "Flexible spine with 30 vertebrae and specialized collarbones enabling remarkable agility, balance, and righting reflex.",
                    "Acoustic frequency range extending up to 64,000 Hz, significantly surpassing canine and human auditory ranges.",
                    "Specialized vibrissae (whiskers) providing tactile spatial awareness and navigation in low-light environments.",
                ],
                "table": None,
            },
            {
                "heading": "Key Feline Milestones & Taxonomy",
                "bullets": [],
                "table": [
                    ["Historical Era / Category", "Key Milestone / Discovery", "Significance to Humans & Ecology"],
                    ["7500 BCE (Near East)", "Earliest archeological burial evidence", "Demonstrated intentional human-feline companionship"],
                    ["1500 BCE (Ancient Egypt)", "Full domestication and sacred status", "Protection of grain granaries and cultural iconography"],
                    ["Middle Ages (Europe)", "Maritime pest suppression", "Crucial protection of trade ships against rodent-borne diseases"],
                    ["1871 (Crystal Palace)", "First National Cat Show in London", "Standardization and formal breeding registry emergence"],
                    ["21st Century", "Genomic sequencing & behavioral science", "Advanced veterinary medicine, genetics, and cognitive study"],
                ],
            },
            {
                "heading": "Behavioral Insights & Communication",
                "bullets": [
                    "Vocalizations: Purring serves multiple functions including mother-kitten bonding, self-healing vibration frequencies (20-140 Hz), and comfort seeking.",
                    "Scent Marking: Facial pheromones (F3/F4) deposited by rubbing cheeks establish territory security and positive association.",
                    "Body Language: Tail position, ear orientation, and slow blinking ('cat kisses') communicate emotional states and trust levels.",
                ],
                "table": None,
            },
        ]
    elif any(k in lower_prompt for k in ['ai', 'artificial intelligence', 'machine learning', 'deep learning', 'tech', 'software']):
        sections = [
            {
                "heading": "Executive Summary & Technological Landscape",
                "bullets": [
                    "Artificial Intelligence has transformed from academic research into a foundational general-purpose technology driving global industry innovation.",
                    "Modern breakthroughs are fueled by large-scale deep learning architectures, high-performance GPU computing, and vast datasets.",
                    "Current paradigms emphasize multimodal foundation models capable of reasoning across text, code, vision, audio, and structured data.",
                    "Enterprise adoption spans automated workflows, predictive analytics, intelligent agent orchestration, and accelerated scientific discovery.",
                ],
                "table": None,
            },
            {
                "heading": "Architecture & Core Capabilities",
                "bullets": [
                    "Transformer Attention Mechanisms: Enabling contextual comprehension across massive token windows with dynamic self-attention.",
                    "Reinforcement Learning with Human Feedback (RLHF): Aligning model safety, coherence, and instruction fidelity.",
                    "Retrieval-Augmented Generation (RAG): Grounding neural generation in verified external knowledge repositories with vector search.",
                    "Autonomous Tool Integration: Allowing AI systems to execute code, browse databases, and interact with external APIs seamlessly.",
                ],
                "table": None,
            },
            {
                "heading": "Comparative Analysis Across Key AI Epochs",
                "bullets": [],
                "table": [
                    ["Epoch / Paradigm", "Key Technological Driver", "Primary Capabilities & Industry Impact"],
                    ["Symbolic AI (1950s-1980s)", "Rule-based expert systems & logic", "Formal problem solving and domain-specific reasoning"],
                    ["Statistical ML (1990s-2000s)", "Support Vector Machines, Random Forests", "Spam filtering, recommendation engines, data mining"],
                    ["Deep Learning (2010s)", "Convolutional & Recurrent Neural Nets", "Human-level image recognition and speech transcription"],
                    ["Generative Era (2020s+)", "Large Language & Diffusion Models", "Zero-shot reasoning, multimodal synthesis, agentic workflows"],
                ],
            },
            {
                "heading": "Strategic Insights & Implementation Roadmap",
                "bullets": [
                    "Data Governance: Ensuring data cleanliness, provenance tracking, and privacy compliance across production pipelines.",
                    "Model Evaluation: Establishing continuous benchmarking for latency, hallucination rates, accuracy, and token economics.",
                    "Security & Alignment: Implementing guardrails against prompt injection, data exfiltration, and model drift.",
                ],
                "table": None,
            },
        ]
    else:
        sections = [
            {
                "heading": "1. Executive Summary & Overview",
                "bullets": [
                    f"This document provides a comprehensive structured breakdown of {title}.",
                    "Analyzing key foundational pillars, historical evolution, and contemporary significance.",
                    "Designed to offer structured clarity, operational context, and actionable takeaways for stakeholders.",
                ],
                "table": None,
            },
            {
                "heading": "2. Core Principles & Key Insights",
                "bullets": [
                    f"Detailed examination of the fundamental mechanisms and drivers shaping {title}.",
                    "Identification of critical success factors, architectural frameworks, and operational methodologies.",
                    "Empirical observations and analytical findings regarding performance, efficiency, and adoption.",
                    "Risk mitigation strategies and best-practice guidelines for scalable execution.",
                ],
                "table": None,
            },
            {
                "heading": "3. Comparative Metrics & Analysis",
                "bullets": [],
                "table": [
                    ["Domain Dimension", "Key Characteristics", "Strategic Impact & Assessment"],
                    ["Foundational Phase", "Initial establishment, core objectives, and scoping", "Establishes baseline stability and requirements"],
                    ["Operational Execution", "Process optimization, workflow integration, and rigor", "Maximizes efficiency, consistency, and velocity"],
                    ["Analysis & Verification", "Quality assurance, metrics tracking, and validation", "Ensures high fidelity and error minimization"],
                    ["Future Optimization", "Scalability enhancements, innovation, and expansion", "Sustains long-term growth and domain leadership"],
                ],
            },
            {
                "heading": "4. Strategic Recommendations & Action Plan",
                "bullets": [
                    "Prioritize iterative development and continuous validation against established benchmarks.",
                    "Maintain structured documentation, transparent communication, and data integrity throughout.",
                    "Leverage modern tooling and automated frameworks to drive sustainable, high-impact outcomes.",
                ],
                "table": None,
            },
        ]

    return {"title": title, "sections": sections}


def _parse_markdown_outline(text, original_prompt=""):
    """Parse markdown outline or structured text into {"title": str, "sections": [{"heading", "bullets", "paragraphs", "table"}]}.
    Resilient to markdown headers (#, ##, ###), bold headers (**Heading**), tables, and lists.
    """
    if not text or not isinstance(text, str) or not text.strip():
        return _generate_fallback_structure(original_prompt)

    title = ""
    sections = []
    current = None

    lines = text.splitlines()

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        # Detect Document Title (# Title or Title:)
        if line.startswith('# ') and not title:
            title = line[2:].strip().strip('#*')
            continue

        # Detect Section Headings (##, ###, ####, or bold **Heading**)
        is_heading = False
        heading_text = ""

        if line.startswith(('## ', '### ', '#### ')):
            is_heading = True
            heading_text = re.sub(r'^#+\s*', '', line).strip().strip('*_')
        elif re.match(r'^(?:\d+[\.\)]\s+)?\*\*(.+?)\*\*:?$', line):
            m = re.match(r'^(?:\d+[\.\)]\s+)?\*\*(.+?)\*\*:?$', line)
            is_heading = True
            heading_text = m.group(1).strip()
        elif re.match(r'^(?:Section\s+\d+|Chapter\s+\d+|\d+\.)\s+([A-Z].+)$', line) and len(line) < 80 and not line.endswith('.'):
            is_heading = True
            heading_text = line.strip('*_')

        if is_heading and heading_text:
            if not title:
                title = heading_text
            current = {"heading": heading_text, "blocks": [], "bullets": [], "paragraphs": [], "table": []}
            sections.append(current)
            continue

        # Initial Overview section if no heading encountered yet
        if current is None:
            if not title and len(line) < 80 and not line.startswith(('-', '*', '|')):
                title = line.strip('*_# ')
                continue
            current = {"heading": "Executive Summary", "blocks": [], "bullets": [], "paragraphs": [], "table": []}
            sections.append(current)

        # Detect Tables
        if line.startswith('|') and line.endswith('|'):
            if _TABLE_SEPARATOR_RE.match(line):
                continue
            cells = [c.strip() for c in line.strip('|').split('|')]
            if any(cells):
                current["table"].append(cells)
                # Contiguous table rows collapse into one block so the table
                # renders as a single unit at the point it appeared.
                if current["blocks"] and current["blocks"][-1]["type"] == "table":
                    current["blocks"][-1]["rows"].append(cells)
                else:
                    current["blocks"].append({"type": "table", "rows": [cells]})
            continue

        # Detect Bullet Points
        if re.match(r'^(?:[-*+]|\d+[\.\)])\s+', line):
            clean_bullet = re.sub(r'^(?:[-*+]|\d+[\.\)])\s+', '', line).strip()
            if clean_bullet:
                current["bullets"].append(clean_bullet)
                current["blocks"].append({"type": "bullet", "text": clean_bullet})
            continue

        # Regular descriptive text line
        if len(line) > 1:
            current["paragraphs"].append(line)
            current["blocks"].append({"type": "paragraph", "text": line})

    # Normalize sections: ensure table or bullets/paragraphs
    valid_sections = []
    for section in sections:
        has_table = section["table"] and len(section["table"]) >= 2
        has_bullets = bool(section["bullets"])
        has_paragraphs = bool(section["paragraphs"])

        if has_table or has_bullets or has_paragraphs:
            if not has_table:
                section["table"] = None
            valid_sections.append(section)

    if not title:
        title = _clean_subject_title(original_prompt)

    if not valid_sections:
        return _generate_fallback_structure(original_prompt)

    return {"title": title or "Untitled Document", "sections": valid_sections}


def _get_ordered_blocks(section):
    """Return a section's content as one ordered list of typed blocks
    ({"type": "paragraph"|"bullet", "text": ...} or {"type": "table", "rows": ...}),
    preserving the order things appeared in the source text.

    Sections built by _parse_markdown_outline already carry this in
    section["blocks"]. Sections from _generate_fallback_structure (hardcoded
    canned content that never mixes bullets/paragraphs/a table within one
    section) don't, so it's synthesized here in the builders' original
    paragraphs -> table -> bullets order, which is a no-op for those since
    only one type is ever non-empty per section anyway.
    """
    if section.get("blocks"):
        return section["blocks"]
    blocks = []
    for p in section.get("paragraphs") or []:
        blocks.append({"type": "paragraph", "text": p})
    if section.get("table"):
        blocks.append({"type": "table", "rows": section["table"]})
    for b in section.get("bullets") or []:
        blocks.append({"type": "bullet", "text": b})
    return blocks


def generate_document_structure(prompt, language="en"):
    """Parse prompt or outline into document structure."""
    if "\n" in prompt or prompt.startswith("#"):
        return _parse_markdown_outline(prompt, original_prompt=prompt)
    return _generate_fallback_structure(prompt, language=language)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Microsoft Word (.docx) Engine: Creation, Surgical Editing, and Reading
# ─────────────────────────────────────────────────────────────────────────────
def _style_word_table(table, has_header=True):
    """Apply modern corporate table styling to a docx table."""
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for row_idx, row in enumerate(table.rows):
        trPr = row._tr.get_or_add_trPr()
        trPr.append(parse_xml(r'<w:cantSplit xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'))

        if row_idx == 0 and has_header:
            trPr.append(parse_xml(r'<w:tblHeader xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'))
            for cell in row.cells:
                shading = parse_xml(r'<w:shd xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:fill="1E293B"/>')
                cell._tc.get_or_add_tcPr().append(shading)
                for paragraph in cell.paragraphs:
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
                    for run in paragraph.runs:
                        run.font.bold = True
                        run.font.color.rgb = RGBColor(255, 255, 255)
                        run.font.size = Pt(9.5)
        else:
            bg_color = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
            for cell in row.cells:
                if bg_color != "FFFFFF":
                    shading = parse_xml(f'<w:shd xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:fill="{bg_color}"/>')
                    cell._tc.get_or_add_tcPr().append(shading)
                for paragraph in cell.paragraphs:
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
                    for run in paragraph.runs:
                        run.font.size = Pt(9.5)
                        run.font.color.rgb = RGBColor(30, 41, 59)

        for cell in row.cells:
            tcPr = cell._tc.get_or_add_tcPr()
            tcMar = parse_xml(
                r'<w:tcMar xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                r'<w:top w:w="120" w:type="dxa"/>'
                r'<w:bottom w:w="120" w:type="dxa"/>'
                r'<w:left w:w="160" w:type="dxa"/>'
                r'<w:right w:w="160" w:type="dxa"/>'
                r'</w:tcMar>'
            )
            tcPr.append(tcMar)


def _build_docx(structure, filepath):
    """Build a beautifully styled Microsoft Word document (.docx)."""
    doc = Document()

    sections = doc.sections
    for s in sections:
        s.top_margin = Inches(0.8)
        s.bottom_margin = Inches(0.8)
        s.left_margin = Inches(0.8)
        s.right_margin = Inches(0.8)

    title_p = doc.add_paragraph()
    title_run = title_p.add_run(structure.get("title") or "Document")
    title_run.font.name = "Arial"
    title_run.font.size = Pt(24)
    title_run.font.bold = True
    title_run.font.color.rgb = RGBColor(15, 23, 42)
    title_p.paragraph_format.space_after = Pt(4)
    title_p.paragraph_format.space_before = Pt(0)

    sub_p = doc.add_paragraph()
    sub_run = sub_p.add_run("Generated with PRAGNA 1-A Document Intelligence Engine")
    sub_run.font.name = "Arial"
    sub_run.font.size = Pt(9)
    sub_run.font.color.rgb = RGBColor(100, 116, 139)
    sub_p.paragraph_format.space_after = Pt(16)

    for sec in structure.get("sections", []):
        h = sec.get("heading")
        if h:
            h_p = doc.add_paragraph()
            h_run = h_p.add_run(h)
            h_run.font.name = "Arial"
            h_run.font.size = Pt(14)
            h_run.font.bold = True
            h_run.font.color.rgb = RGBColor(30, 41, 59)
            h_p.paragraph_format.space_before = Pt(14)
            h_p.paragraph_format.space_after = Pt(6)

        for block in _get_ordered_blocks(sec):
            if block["type"] == "paragraph":
                p = doc.add_paragraph()
                r = p.add_run(block["text"])
                r.font.name = "Arial"
                r.font.size = Pt(10.5)
                r.font.color.rgb = RGBColor(51, 65, 85)
                p.paragraph_format.space_after = Pt(4)
                p.paragraph_format.line_spacing = 1.15

            elif block["type"] == "table":
                rows = block["rows"]
                if not rows:
                    continue
                num_cols = max(len(r) for r in rows)
                table = doc.add_table(rows=len(rows), cols=num_cols)
                table.style = "Table Grid"

                for r_idx, row in enumerate(rows):
                    for c_idx in range(num_cols):
                        val = str(row[c_idx]) if c_idx < len(row) else ""
                        table.cell(r_idx, c_idx).text = val

                _style_word_table(table, has_header=True)
                doc.add_paragraph().paragraph_format.space_after = Pt(6)

            elif block["type"] == "bullet":
                b_p = doc.add_paragraph(style="List Bullet")
                b_run = b_p.add_run(block["text"])
                b_run.font.name = "Arial"
                b_run.font.size = Pt(10.5)
                b_run.font.color.rgb = RGBColor(51, 65, 85)
                b_p.paragraph_format.space_after = Pt(3)
                b_p.paragraph_format.line_spacing = 1.15

    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    doc.save(filepath)
    return filepath


def edit_word_document(filepath, action, **kwargs):
    """Surgically edit an existing .docx file.
    Supported actions:
    - 'append_section': heading, paragraphs, bullets, table
    - 'replace_text': search, replace (searches all paragraphs and table cells)
    - 'add_paragraph': text, bold, italic
    - 'add_table': rows (2D array)
    """
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"Word document not found at {filepath}")

    doc = Document(str(path_obj))
    modified = False

    if action == "append_section":
        heading = kwargs.get("heading")
        if heading:
            h_p = doc.add_paragraph()
            h_run = h_p.add_run(heading)
            h_run.font.name = "Arial"
            h_run.font.size = Pt(14)
            h_run.font.bold = True
            h_run.font.color.rgb = RGBColor(30, 41, 59)
            h_p.paragraph_format.space_before = Pt(14)
            h_p.paragraph_format.space_after = Pt(6)

        paragraphs = kwargs.get("paragraphs") or []
        if isinstance(paragraphs, str):
            paragraphs = [paragraphs]
        for p_text in paragraphs:
            p = doc.add_paragraph()
            r = p.add_run(p_text)
            r.font.name = "Arial"
            r.font.size = Pt(10.5)
            p.paragraph_format.space_after = Pt(4)

        bullets = kwargs.get("bullets") or []
        for b in bullets:
            b_p = doc.add_paragraph(style="List Bullet")
            b_run = b_p.add_run(b)
            b_run.font.name = "Arial"
            b_run.font.size = Pt(10.5)
            b_p.paragraph_format.space_after = Pt(3)

        table_data = kwargs.get("table")
        if table_data and len(table_data) > 0:
            num_cols = max(len(r) for r in table_data)
            tbl = doc.add_table(rows=len(table_data), cols=num_cols)
            tbl.style = "Table Grid"
            for r_idx, row in enumerate(table_data):
                for c_idx in range(num_cols):
                    val = str(row[c_idx]) if c_idx < len(row) else ""
                    tbl.cell(r_idx, c_idx).text = val
            _style_word_table(tbl, has_header=True)
        modified = True

    elif action == "replace_text":
        search = kwargs.get("search", "")
        replace = kwargs.get("replace", "")
        if not search:
            raise ValueError("search string is required for replace_text")

        replace_count = 0
        for p in doc.paragraphs:
            if search in p.text:
                for run in p.runs:
                    if search in run.text:
                        run.text = run.text.replace(search, replace)
                        replace_count += 1
                if search in p.text:
                    p.text = p.text.replace(search, replace)
                    replace_count += 1

        for tbl in doc.tables:
            for row in tbl.rows:
                for cell in row.cells:
                    if search in cell.text:
                        for cp in cell.paragraphs:
                            if search in cp.text:
                                for run in cp.runs:
                                    if search in run.text:
                                        run.text = run.text.replace(search, replace)
                                        replace_count += 1
                                if search in cp.text:
                                    cp.text = cp.text.replace(search, replace)
                                    replace_count += 1
        modified = replace_count > 0

    elif action == "add_paragraph":
        text = kwargs.get("text", "")
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.font.name = "Arial"
        run.font.size = Pt(10.5)
        if kwargs.get("bold"):
            run.font.bold = True
        if kwargs.get("italic"):
            run.font.italic = True
        modified = True

    elif action == "add_table":
        table_data = kwargs.get("table") or []
        if table_data:
            num_cols = max(len(r) for r in table_data)
            tbl = doc.add_table(rows=len(table_data), cols=num_cols)
            tbl.style = "Table Grid"
            for r_idx, row in enumerate(table_data):
                for c_idx in range(num_cols):
                    tbl.cell(r_idx, c_idx).text = str(row[c_idx]) if c_idx < len(row) else ""
            _style_word_table(tbl, has_header=True)
            modified = True

    else:
        raise ValueError(f"Unknown action '{action}' for Word document")

    doc.save(str(path_obj))
    return {"success": True, "filepath": str(path_obj), "action": action, "modified": modified}


def read_word_document(filepath):
    """Read an existing .docx file and return structured markdown and JSON representation."""
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"File not found: {filepath}")

    doc = Document(str(path_obj))
    sections = []
    current_section = {"heading": "Document Content", "items": []}
    markdown_lines = []

    for elem in doc.element.body:
        tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        if tag == 'p':
            p_obj = [p for p in doc.paragraphs if p._element == elem]
            if p_obj:
                p = p_obj[0]
                text = p.text.strip()
                if not text:
                    continue
                style_name = p.style.name.lower() if p.style else ""
                if 'heading 1' in style_name or 'title' in style_name:
                    markdown_lines.append(f"\n# {text}\n")
                    current_section = {"heading": text, "items": []}
                    sections.append(current_section)
                elif 'heading 2' in style_name:
                    markdown_lines.append(f"\n## {text}\n")
                    current_section = {"heading": text, "items": []}
                    sections.append(current_section)
                elif 'heading 3' in style_name:
                    markdown_lines.append(f"\n### {text}\n")
                elif 'bullet' in style_name or 'list' in style_name:
                    markdown_lines.append(f"- {text}")
                    current_section["items"].append({"type": "bullet", "text": text})
                else:
                    markdown_lines.append(text)
                    current_section["items"].append({"type": "paragraph", "text": text})
        elif tag == 'tbl':
            tbl_obj = [t for t in doc.tables if t._element == elem]
            if tbl_obj:
                tbl = tbl_obj[0]
                table_matrix = []
                for row in tbl.rows:
                    table_matrix.append([cell.text.strip() for cell in row.cells])
                if table_matrix:
                    header = table_matrix[0]
                    markdown_lines.append("\n| " + " | ".join(header) + " |")
                    markdown_lines.append("| " + " | ".join(["---"] * len(header)) + " |")
                    for r in table_matrix[1:]:
                        markdown_lines.append("| " + " | ".join(r) + " |")
                    markdown_lines.append("")
                    current_section["items"].append({"type": "table", "data": table_matrix})

    if not sections and current_section["items"]:
        sections.append(current_section)

    return {
        "success": True,
        "filepath": str(path_obj),
        "markdown": "\n".join(markdown_lines).strip(),
        "sections": sections,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 4. PDF Engine: Publication-Quality Creation and Reading
# ─────────────────────────────────────────────────────────────────────────────
def _build_pdf(structure, filepath):
    """Build an aesthetically styled, publication-grade PDF document."""
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        filepath,
        pagesize=letter,
        leftMargin=40,
        rightMargin=40,
        topMargin=40,
        bottomMargin=45,
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Title'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=colors.HexColor('#0F172A'),
        alignment=0,
        spaceAfter=12,
    )

    h2_style = ParagraphStyle(
        'DocHeading2',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=colors.HexColor('#1E293B'),
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True,
    )

    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14.5,
        textColor=colors.HexColor('#334155'),
        spaceAfter=4,
    )

    bullet_style = ParagraphStyle(
        'DocBullet',
        parent=body_style,
        leftIndent=14,
        firstLineIndent=-10,
        spaceAfter=3,
    )

    cell_style = ParagraphStyle(
        'DocCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#1E293B'),
    )

    cell_header_style = ParagraphStyle(
        'DocCellHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#FFFFFF'),
    )

    story = [
        Paragraph(html.escape(structure.get("title") or "Document"), title_style),
        HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#E2E8F0'), spaceAfter=14),
    ]

    for section in structure.get("sections", []):
        heading = section.get("heading")
        if heading:
            story.append(Paragraph(html.escape(heading), h2_style))
            story.append(Spacer(1, 4))

        for block in _get_ordered_blocks(section):
            if block["type"] == "paragraph":
                story.append(Paragraph(html.escape(block["text"]), body_style))

            elif block["type"] == "table":
                raw_table = block["rows"]
                if not raw_table:
                    continue
                num_cols = max(len(r) for r in raw_table)
                available_width = 532.0
                col_width = available_width / max(num_cols, 1)

                formatted_table_data = []
                for r_idx, row in enumerate(raw_table):
                    row_cells = []
                    for c_idx in range(num_cols):
                        val = str(row[c_idx]) if c_idx < len(row) else ""
                        st = cell_header_style if r_idx == 0 else cell_style
                        row_cells.append(Paragraph(html.escape(val), st))
                    formatted_table_data.append(row_cells)

                pdf_table = PdfTable(formatted_table_data, colWidths=[col_width] * num_cols)
                pdf_table.setStyle(
                    TableStyle([
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor('#1E293B')),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor('#FFFFFF'), colors.HexColor('#F8FAFC')]),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ("LEFTPADDING", (0, 0), (-1, -1), 6),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ])
                )
                story.append(pdf_table)
                story.append(Spacer(1, 6))

            elif block["type"] == "bullet":
                bullet_escaped = html.escape(block["text"])
                story.append(Paragraph(f"&bull;&nbsp; {bullet_escaped}", bullet_style))

        story.append(Spacer(1, 8))

    doc.build(story, canvasmaker=NumberedCanvas)
    _save_pdf_structure_sidecar(filepath, structure)
    return filepath


def _pdf_sidecar_path(filepath):
    return Path(str(filepath) + ".structure.json")


def _save_pdf_structure_sidecar(filepath, structure):
    """Persist the section structure used to build a PDF so it can be edited later.

    Reportlab only draws finished pages -- it cannot reopen and mutate a PDF the
    way python-docx/openpyxl can. Keeping the source structure alongside the file
    lets edit_pdf_document() apply surgical changes and rebuild the PDF from it.
    """
    try:
        sidecar = _pdf_sidecar_path(filepath)
        sidecar.write_text(json.dumps(structure), encoding="utf-8")
    except Exception:
        logger.warning("Could not write PDF structure sidecar for %s", filepath, exc_info=True)


def _load_pdf_structure_sidecar(filepath):
    sidecar = _pdf_sidecar_path(filepath)
    if not sidecar.exists():
        return None
    try:
        return json.loads(sidecar.read_text(encoding="utf-8"))
    except Exception:
        return None


def read_pdf_document(filepath, page_start=None, page_end=None):
    """Extract text, page count, and metadata from a PDF file using pypdf."""
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"PDF file not found at {filepath}")

    reader = pypdf.PdfReader(str(path_obj))
    total_pages = len(reader.pages)

    start = max(0, (page_start or 1) - 1)
    end = min(total_pages, page_end or total_pages)

    pages_text = []
    for idx in range(start, end):
        p = reader.pages[idx]
        txt = p.extract_text() or ""
        pages_text.append(f"--- Page {idx + 1} ---\n{txt}")

    metadata = {}
    if reader.metadata:
        for k, v in reader.metadata.items():
            clean_k = k.lstrip('/')
            metadata[clean_k] = str(v)

    return {
        "success": True,
        "filepath": str(path_obj),
        "total_pages": total_pages,
        "page_start": start + 1,
        "page_end": end,
        "metadata": metadata,
        "content": "\n\n".join(pages_text),
    }


def edit_pdf_document(filepath, action, **kwargs):
    """Surgically edit a PDF by editing its source section structure and rebuilding it.

    Uses the structure sidecar saved by _build_pdf when available. Falls back to
    reconstructing a best-effort structure from the PDF's extracted text (e.g. for
    a PDF that wasn't originally generated by this engine).

    Supported actions (mirrors edit_word_document):
    - 'append_section': heading, paragraphs, bullets, table
    - 'replace_text': search, replace (across title, headings, paragraphs, bullets, table cells)
    - 'add_paragraph': text (appended to a trailing "Notes" section)
    - 'add_table': table (2D array), appended as a new section
    """
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"PDF file not found at {filepath}")

    structure = _load_pdf_structure_sidecar(filepath)
    if structure is None:
        extracted = read_pdf_document(filepath)
        structure = _parse_markdown_outline(extracted["content"], original_prompt=path_obj.stem)

    if action == "append_section":
        heading = kwargs.get("heading")
        paragraphs = kwargs.get("paragraphs") or []
        if isinstance(paragraphs, str):
            paragraphs = [paragraphs]
        bullets = kwargs.get("bullets") or []
        table = kwargs.get("table")
        structure.setdefault("sections", []).append({
            "heading": heading,
            "paragraphs": paragraphs,
            "bullets": bullets,
            "table": table,
        })
        modified = True

    elif action == "replace_text":
        search = kwargs.get("search", "")
        replace = kwargs.get("replace", "")
        if not search:
            raise ValueError("search string is required for replace_text")

        replaced = False
        if structure.get("title") and search in structure["title"]:
            structure["title"] = structure["title"].replace(search, replace)
            replaced = True

        for section in structure.get("sections", []):
            if section.get("heading") and search in section["heading"]:
                section["heading"] = section["heading"].replace(search, replace)
                replaced = True
            for key in ("paragraphs", "bullets"):
                items = section.get(key, [])
                if any(search in item for item in items):
                    replaced = True
                section[key] = [item.replace(search, replace) for item in items]
            if section.get("table"):
                new_table = []
                for row in section["table"]:
                    new_row = [str(c).replace(search, replace) for c in row]
                    if new_row != [str(c) for c in row]:
                        replaced = True
                    new_table.append(new_row)
                section["table"] = new_table
        modified = replaced

    elif action == "add_paragraph":
        text = kwargs.get("text", "")
        notes_section = next((s for s in structure.get("sections", []) if s.get("heading") == "Notes"), None)
        if notes_section is None:
            notes_section = {"heading": "Notes", "paragraphs": [], "bullets": [], "table": None}
            structure.setdefault("sections", []).append(notes_section)
        notes_section.setdefault("paragraphs", []).append(text)
        modified = True

    elif action == "add_table":
        table_data = kwargs.get("table") or []
        structure.setdefault("sections", []).append({
            "heading": kwargs.get("heading"),
            "paragraphs": [],
            "bullets": [],
            "table": table_data,
        })
        modified = True

    else:
        raise ValueError(f"Unknown action '{action}' for PDF document")

    _build_pdf(structure, str(path_obj))
    return {"success": True, "filepath": str(path_obj), "action": action, "modified": modified}


# ─────────────────────────────────────────────────────────────────────────────
# 5. Excel / Spreadsheet (.xlsx / .csv) Engine: Multi-sheet, Formulas, Styling
# ─────────────────────────────────────────────────────────────────────────────
def _build_xlsx(structure, filepath, sheets=None):
    """Build a styled Excel workbook (.xlsx) with header highlights, auto-fit, and formulas."""
    wb = Workbook()
    wb.remove(wb.active)

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    alt_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    border_side = Side(style='thin', color='CBD5E1')
    cell_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

    if sheets and isinstance(sheets, list):
        for s_spec in sheets:
            s_name = _sanitize_sheet_name(s_spec.get("name") or "Sheet")
            ws = wb.create_sheet(title=s_name)
            headers = s_spec.get("headers") or []
            rows = s_spec.get("rows") or []

            if headers:
                ws.append(headers)
                for col_idx in range(1, len(headers) + 1):
                    c = ws.cell(row=1, column=col_idx)
                    c.font = header_font
                    c.fill = header_fill
                    c.alignment = Alignment(horizontal="center", vertical="center")
                    c.border = cell_border

            for r_idx, row in enumerate(rows, start=2 if headers else 1):
                ws.append(row)
                row_fill = alt_fill if r_idx % 2 == 1 else None
                for col_idx in range(1, len(row) + 1):
                    c = ws.cell(row=r_idx, column=col_idx)
                    c.border = cell_border
                    if row_fill:
                        c.fill = row_fill

            formulas = s_spec.get("formulas") or {}
            for cell_coord, formula in formulas.items():
                ws[cell_coord] = formula

            for col in ws.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 14), 50)
    else:
        table_sections = [s for s in structure.get("sections", []) if s.get("table")]
        if table_sections:
            for s_idx, sec in enumerate(table_sections):
                sheet_title = _sanitize_sheet_name(sec.get("heading") or f"Data_{s_idx+1}")
                ws = wb.create_sheet(sheet_title)
                rows = sec["table"]
                for r_idx, row in enumerate(rows, start=1):
                    ws.append(row)
                    if r_idx == 1:
                        for col_idx in range(1, len(row) + 1):
                            cell = ws.cell(row=1, column=col_idx)
                            cell.font = header_font
                            cell.fill = header_fill
                            cell.alignment = Alignment(horizontal="center", vertical="center")
                            cell.border = cell_border
                    else:
                        row_fill = alt_fill if r_idx % 2 == 1 else None
                        for col_idx in range(1, len(row) + 1):
                            c = ws.cell(row=r_idx, column=col_idx)
                            c.border = cell_border
                            if row_fill:
                                c.fill = row_fill
                for col in ws.columns:
                    max_len = max(len(str(cell.value or '')) for cell in col)
                    col_letter = get_column_letter(col[0].column)
                    ws.column_dimensions[col_letter].width = min(max(max_len + 3, 14), 50)
        else:
            ws = wb.create_sheet("Summary")
            ws.append(["Section", "Content"])
            for col_idx in (1, 2):
                cell = ws.cell(row=1, column=col_idx)
                cell.font = header_font
                cell.fill = header_fill

            for sec in structure.get("sections", []):
                heading = sec.get("heading", "")
                for block in _get_ordered_blocks(sec):
                    if block["type"] == "table":
                        for row in block["rows"]:
                            ws.append([heading, " | ".join(str(c) for c in row)])
                    else:
                        ws.append([heading, block["text"]])

            for col in ws.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 14), 50)

    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    wb.save(filepath)
    return filepath


def edit_spreadsheet(filepath, action, **kwargs):
    """Edit an existing Excel (.xlsx) file.
    Supported actions:
    - 'append_rows': sheet_name, rows (2D array)
    - 'update_cell': sheet_name, cell (e.g. 'B4'), value
    - 'add_sheet': sheet_name, headers, rows
    """
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"Spreadsheet not found at {filepath}")

    wb = load_workbook(str(path_obj))
    sheet_name = kwargs.get("sheet_name")

    if action == "append_rows":
        ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
        rows = kwargs.get("rows") or []
        for r in rows:
            ws.append(r)

    elif action == "update_cell":
        ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
        cell_coord = kwargs.get("cell")
        if not cell_coord:
            raise ValueError("cell coordinate (e.g. 'A1') is required for update_cell")
        ws[cell_coord] = kwargs.get("value")

    elif action == "add_sheet":
        new_name = _sanitize_sheet_name(sheet_name or f"Sheet_{len(wb.sheetnames)+1}")
        ws = wb.create_sheet(title=new_name)
        headers = kwargs.get("headers") or []
        rows = kwargs.get("rows") or []
        if headers:
            ws.append(headers)
        for r in rows:
            ws.append(r)

    else:
        raise ValueError(f"Unknown action '{action}' for spreadsheet")

    wb.save(str(path_obj))
    return {"success": True, "filepath": str(path_obj), "action": action}


def read_spreadsheet(filepath, sheet_name=None, max_rows=100):
    """Read an Excel (.xlsx) or CSV file and return sheets, tables, and markdown."""
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"File not found: {filepath}")

    if path_obj.suffix.lower() == ".csv":
        rows = []
        with open(path_obj, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f)
            for r in reader:
                rows.append(r)
                if len(rows) >= max_rows:
                    break

        md_lines = []
        if rows:
            md_lines.append("| " + " | ".join(rows[0]) + " |")
            md_lines.append("| " + " | ".join(["---"] * len(rows[0])) + " |")
            for r in rows[1:]:
                md_lines.append("| " + " | ".join(r) + " |")

        return {
            "success": True,
            "filepath": str(path_obj),
            "sheets": [{"name": path_obj.stem, "rows": rows}],
            "markdown": "\n".join(md_lines),
        }

    wb = load_workbook(str(path_obj), data_only=True)
    sheets_data = []
    all_md_lines = []

    target_sheets = [wb[sheet_name]] if sheet_name and sheet_name in wb.sheetnames else wb.worksheets

    for ws in target_sheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            if any(cell is not None for cell in row):
                rows.append([str(c) if c is not None else "" for c in row])
            if len(rows) >= max_rows:
                break

        sheets_data.append({"name": ws.title, "rows": rows})

        all_md_lines.append(f"### Sheet: {ws.title}\n")
        if rows:
            header = rows[0]
            all_md_lines.append("| " + " | ".join(header) + " |")
            all_md_lines.append("| " + " | ".join(["---"] * len(header)) + " |")
            for r in rows[1:]:
                all_md_lines.append("| " + " | ".join(r) + " |")
        all_md_lines.append("")

    return {
        "success": True,
        "filepath": str(path_obj),
        "sheet_names": wb.sheetnames,
        "sheets": sheets_data,
        "markdown": "\n".join(all_md_lines).strip(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 6. PowerPoint (.pptx) Presentation Engine
# ─────────────────────────────────────────────────────────────────────────────
def _build_pptx(structure, filepath, slides=None):
    """Build a clean, high-impact PowerPoint presentation deck (.pptx)."""
    prs = Presentation()

    if slides and isinstance(slides, list):
        for s_idx, s in enumerate(slides):
            layout_type = s.get("layout", "bullet")
            if s_idx == 0 and layout_type == "title":
                slide = prs.slides.add_slide(prs.slide_layouts[0])
                slide.shapes.title.text = s.get("title") or "Presentation"
                if s.get("subtitle") and len(slide.placeholders) > 1:
                    slide.placeholders[1].text = s.get("subtitle")
            else:
                slide = prs.slides.add_slide(prs.slide_layouts[1])
                slide.shapes.title.text = s.get("title") or f"Slide {s_idx+1}"
                body = slide.placeholders[1].text_frame
                body.clear()
                bullets = s.get("content") or s.get("bullets") or []
                for i, b in enumerate(bullets):
                    if i == 0:
                        body.text = b
                    else:
                        p = body.add_paragraph()
                        p.text = b
    else:
        title_slide = prs.slides.add_slide(prs.slide_layouts[0])
        title_slide.shapes.title.text = structure.get("title") or "Presentation"
        if len(title_slide.placeholders) > 1:
            title_slide.placeholders[1].text = "PRAGNA 1-A Document Intelligence Presentation"

        for sec in structure.get("sections", []):
            slide = prs.slides.add_slide(prs.slide_layouts[1])
            slide.shapes.title.text = sec.get("heading") or "Section"
            body = slide.placeholders[1].text_frame
            body.clear()

            lines = []
            for block in _get_ordered_blocks(sec):
                if block["type"] in ("bullet", "paragraph"):
                    lines.append(block["text"])
                elif block["type"] == "table":
                    lines.extend(" | ".join(str(c) for c in row) for row in block["rows"])

            for i, line in enumerate(lines):
                if i == 0:
                    body.text = line
                else:
                    body.add_paragraph().text = line

    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    prs.save(filepath)
    return filepath


def _pptx_slide_body_text_frame(slide):
    """Return the first non-title placeholder's text_frame on a slide, if any."""
    title_shape = slide.shapes.title
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        if title_shape is not None and shape.shape_id == title_shape.shape_id:
            continue
        return shape.text_frame
    return None


def read_presentation(filepath):
    """Read an existing .pptx file and return each slide's title and body lines."""
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"Presentation not found at {filepath}")

    prs = Presentation(str(path_obj))
    slides_data = []
    markdown_lines = []

    for slide in prs.slides:
        title_shape = slide.shapes.title
        title_text = title_shape.text.strip() if title_shape is not None and title_shape.has_text_frame else ""

        bullets = []
        body_tf = _pptx_slide_body_text_frame(slide)
        if body_tf is not None:
            for para in body_tf.paragraphs:
                text = para.text.strip()
                if text:
                    bullets.append(text)

        slides_data.append({"title": title_text, "bullets": bullets})
        markdown_lines.append(f"\n## {title_text}\n" if title_text else "\n## Slide\n")
        for b in bullets:
            markdown_lines.append(f"- {b}")

    return {
        "success": True,
        "filepath": str(path_obj),
        "markdown": "\n".join(markdown_lines).strip(),
        "slides": slides_data,
    }


def edit_presentation(filepath, action, **kwargs):
    """Surgically edit an existing .pptx file.
    Supported actions:
    - 'add_slide': title, bullets (or content), layout ('title'|'bullet')
    - 'update_slide': slide_index (0-based), title, bullets
    - 'replace_text': search, replace (across all slides' text)
    """
    path_obj = Path(filepath)
    if not path_obj.exists():
        raise FileNotFoundError(f"Presentation not found at {filepath}")

    prs = Presentation(str(path_obj))
    modified = False

    if action == "add_slide":
        layout_type = kwargs.get("layout", "bullet")
        if layout_type == "title":
            slide = prs.slides.add_slide(prs.slide_layouts[0])
            slide.shapes.title.text = kwargs.get("title") or "Untitled Slide"
            subtitle = kwargs.get("subtitle")
            if subtitle and len(slide.placeholders) > 1:
                slide.placeholders[1].text = subtitle
        else:
            slide = prs.slides.add_slide(prs.slide_layouts[1])
            slide.shapes.title.text = kwargs.get("title") or "Untitled Slide"
            bullets = kwargs.get("bullets") or kwargs.get("content") or []
            body = slide.placeholders[1].text_frame
            body.clear()
            for i, b in enumerate(bullets):
                if i == 0:
                    body.text = b
                else:
                    body.add_paragraph().text = b
        modified = True

    elif action == "update_slide":
        slide_index = kwargs.get("slide_index")
        if slide_index is None:
            raise ValueError("slide_index is required for update_slide")
        if slide_index < 0 or slide_index >= len(prs.slides):
            raise ValueError(f"slide_index {slide_index} is out of range (0-{len(prs.slides) - 1})")

        slide = prs.slides[slide_index]
        title = kwargs.get("title")
        if title is not None and slide.shapes.title is not None:
            slide.shapes.title.text = title
            modified = True

        bullets = kwargs.get("bullets")
        if bullets is not None:
            body_tf = _pptx_slide_body_text_frame(slide)
            if body_tf is not None:
                body_tf.clear()
                for i, b in enumerate(bullets):
                    if i == 0:
                        body_tf.text = b
                    else:
                        body_tf.add_paragraph().text = b
                modified = True

    elif action == "replace_text":
        search = kwargs.get("search", "")
        replace = kwargs.get("replace", "")
        if not search:
            raise ValueError("search string is required for replace_text")

        for slide in prs.slides:
            for shape in slide.shapes:
                if not shape.has_text_frame:
                    continue
                for para in shape.text_frame.paragraphs:
                    for run in para.runs:
                        if search in run.text:
                            run.text = run.text.replace(search, replace)
                            modified = True
                    if not para.runs and search in para.text:
                        para.text = para.text.replace(search, replace)
                        modified = True

    else:
        raise ValueError(f"Unknown action '{action}' for presentation")

    prs.save(str(path_obj))
    return {"success": True, "filepath": str(path_obj), "action": action, "modified": modified}


# ─────────────────────────────────────────────────────────────────────────────
# 7. Document Conversion & Export Helper
# ─────────────────────────────────────────────────────────────────────────────
def export_document(source_path, target_format, output_path=None):
    """Universal converter: converts markdown/text to .docx, .pdf, .xlsx, .pptx, or .html."""
    src = Path(source_path)
    if not src.exists():
        raise FileNotFoundError(f"Source file not found: {source_path}")

    fmt = target_format.lower().lstrip('.')
    if fmt not in {"docx", "pdf", "xlsx", "pptx", "html"}:
        raise ValueError(f"Unsupported export format: {target_format}")

    content = src.read_text(encoding="utf-8", errors="replace")
    structure = _parse_markdown_outline(content, original_prompt=src.stem)

    if not output_path:
        output_path = src.parent / f"{src.stem}.{fmt}"
    else:
        output_path = Path(output_path)

    builders = {
        "docx": _build_docx,
        "pdf": _build_pdf,
        "xlsx": _build_xlsx,
        "pptx": _build_pptx,
    }

    if fmt == "html":
        html_content = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{html.escape(structure.get("title") or src.stem)}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; line-height: 1.6; }}
    h1 {{ font-size: 2rem; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }}
    h2 {{ font-size: 1.3rem; color: #1e293b; margin-top: 24px; }}
    table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }}
    th {{ background: #1e293b; color: #ffffff; }}
    tr:nth-child(even) {{ background: #f8fafc; }}
    ul {{ padding-left: 20px; }}
    li {{ margin-bottom: 6px; }}
  </style>
</head>
<body>
  <h1>{html.escape(structure.get("title") or src.stem)}</h1>
"""
        for sec in structure.get("sections", []):
            if sec.get("heading"):
                html_content += f"  <h2>{html.escape(sec['heading'])}</h2>\n"
            for p in sec.get("paragraphs", []):
                html_content += f"  <p>{html.escape(p)}</p>\n"
            if sec.get("table"):
                html_content += "  <table>\n"
                for r_idx, row in enumerate(sec["table"]):
                    tag = "th" if r_idx == 0 else "td"
                    cells = "".join(f"<{tag}>{html.escape(str(c))}</{tag}>" for c in row)
                    html_content += f"    <tr>{cells}</tr>\n"
                html_content += "  </table>\n"
            if sec.get("bullets"):
                html_content += "  <ul>\n"
                for b in sec["bullets"]:
                    html_content += f"    <li>{html.escape(b)}</li>\n"
                html_content += "  </ul>\n"

        html_content += "</body>\n</html>"
        output_path.write_text(html_content, encoding="utf-8")
    else:
        builders[fmt](structure, str(output_path))

    return {
        "success": True,
        "source": str(src),
        "output": str(output_path),
        "format": fmt,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 8. CLI & Subprocess IPC Handler
# ─────────────────────────────────────────────────────────────────────────────
def _handle_ipc(payload):
    """Execute action requested via JSON payload and return result dict."""
    action = payload.get("action")
    if not action:
        return {"success": False, "error": "Missing 'action' in payload"}

    kwargs = dict(payload)
    kwargs.pop("action", None)
    kwargs.pop("path", None)
    kwargs.pop("sub_action", None)
    kwargs.pop("edit_action", None)

    if action == "create_word":
        filepath = payload.get("path") or f"documents/{int(time.time())}-doc.docx"
        structure = payload.get("structure")
        if not structure:
            content = payload.get("content") or payload.get("prompt") or ""
            structure = _parse_markdown_outline(content, original_prompt=payload.get("title") or "Document")
        if payload.get("title"):
            structure["title"] = payload["title"]
        _build_docx(structure, filepath)
        return {"success": True, "path": filepath, "title": structure.get("title"), "format": "docx"}

    elif action == "edit_word":
        filepath = payload.get("path")
        sub_action = payload.get("sub_action") or payload.get("edit_action") or "append_section"
        return edit_word_document(filepath, sub_action, **kwargs)

    elif action == "read_word":
        return read_word_document(payload.get("path"))

    elif action == "create_pdf":
        filepath = payload.get("path") or f"documents/{int(time.time())}-doc.pdf"
        structure = payload.get("structure")
        if not structure:
            content = payload.get("content") or payload.get("prompt") or ""
            structure = _parse_markdown_outline(content, original_prompt=payload.get("title") or "Document")
        if payload.get("title"):
            structure["title"] = payload["title"]
        _build_pdf(structure, filepath)
        return {"success": True, "path": filepath, "title": structure.get("title"), "format": "pdf"}

    elif action == "read_pdf":
        return read_pdf_document(
            payload.get("path"),
            page_start=payload.get("page_start"),
            page_end=payload.get("page_end"),
        )

    elif action == "edit_pdf":
        filepath = payload.get("path")
        sub_action = payload.get("sub_action") or payload.get("edit_action") or "append_section"
        return edit_pdf_document(filepath, sub_action, **kwargs)

    elif action == "create_spreadsheet":
        filepath = payload.get("path") or f"documents/{int(time.time())}-data.xlsx"
        sheets = payload.get("sheets")
        structure = payload.get("structure")
        if not sheets and not structure:
            content = payload.get("content") or payload.get("prompt") or ""
            structure = _parse_markdown_outline(content, original_prompt=payload.get("title") or "Spreadsheet")
        _build_xlsx(structure or {}, filepath, sheets=sheets)
        return {"success": True, "path": filepath, "format": "xlsx"}

    elif action == "edit_spreadsheet":
        filepath = payload.get("path")
        sub_action = payload.get("sub_action") or "append_rows"
        return edit_spreadsheet(filepath, sub_action, **kwargs)

    elif action == "read_spreadsheet":
        return read_spreadsheet(
            payload.get("path"),
            sheet_name=payload.get("sheet_name"),
            max_rows=payload.get("max_rows", 100),
        )

    elif action == "create_presentation":
        filepath = payload.get("path") or f"documents/{int(time.time())}-deck.pptx"
        slides = payload.get("slides")
        structure = payload.get("structure")
        if not slides and not structure:
            content = payload.get("content") or payload.get("prompt") or ""
            structure = _parse_markdown_outline(content, original_prompt=payload.get("title") or "Presentation")
        _build_pptx(structure or {}, filepath, slides=slides)
        return {"success": True, "path": filepath, "format": "pptx"}

    elif action == "edit_presentation":
        filepath = payload.get("path")
        sub_action = payload.get("sub_action") or payload.get("edit_action") or "add_slide"
        return edit_presentation(filepath, sub_action, **kwargs)

    elif action == "read_presentation":
        return read_presentation(payload.get("path"))

    elif action == "export":
        return export_document(
            payload.get("source_path"),
            payload.get("target_format", "pdf"),
            output_path=payload.get("output_path"),
        )

    return {"success": False, "error": f"Unknown IPC action '{action}'"}


def main():
    parser = argparse.ArgumentParser(description="PRAGNA 1-A Document Generation and Editing Engine")
    parser.add_argument("--json", help="JSON payload string")
    parser.add_argument("--stdin", action="store_true", help="Read JSON payload from stdin")
    args = parser.parse_args()

    if args.stdin:
        try:
            raw = sys.stdin.read()
            payload = json.loads(raw)
            result = _handle_ipc(payload)
            print(json.dumps(result))
            return
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)

    if args.json:
        try:
            payload = json.loads(args.json)
            result = _handle_ipc(payload)
            print(json.dumps(result))
            return
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.exit(1)

    print(json.dumps({"success": True, "message": "PRAGNA 1-A Document Engine ready"}))


if __name__ == "__main__":
    main()
