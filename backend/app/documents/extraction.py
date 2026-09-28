import csv
import io
from dataclasses import dataclass, field

from docx import Document as DocxDocument
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from pypdf import PdfReader

from app.documents.language import detect_language

TARGET_TOKENS = 650
MAX_TOKENS_BEFORE_SPLIT = 800
OVERLAP_TOKENS = 50
ROWS_PER_TABLE_CHUNK = 50


@dataclass
class Section:
    content: str
    page_number: int | None = None
    section_heading: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class ExtractedChunk:
    content: str
    page_number: int | None
    section_heading: str | None
    metadata: dict


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def extract_pdf(content: bytes) -> list[Section]:
    reader = PdfReader(io.BytesIO(content))
    sections = []
    for index, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        if text:
            sections.append(Section(content=text, page_number=index + 1))
    return sections


def extract_docx(content: bytes) -> list[Section]:
    doc = DocxDocument(io.BytesIO(content))
    sections: list[Section] = []
    current_heading: str | None = None
    buffer: list[str] = []

    def flush(heading: str | None, buf: list[str]) -> None:
        text = "\n".join(buf).strip()
        if text:
            sections.append(Section(content=text, section_heading=heading))

    for para in doc.paragraphs:
        style_name = para.style.name if para.style else ""
        if style_name.startswith("Heading"):
            flush(current_heading, buffer)
            buffer = []
            current_heading = para.text
        elif para.text.strip():
            buffer.append(para.text)
    flush(current_heading, buffer)
    return sections


def extract_txt(content: bytes) -> list[Section]:
    text = content.decode("utf-8", errors="replace")
    if not text.strip():
        return []
    return [Section(content=text)]


def extract_csv(content: bytes, rows_per_chunk: int = ROWS_PER_TABLE_CHUNK) -> list[Section]:
    text = content.decode("utf-8", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    header, data_rows = rows[0], rows[1:]

    sections = []
    for start in range(0, len(data_rows), rows_per_chunk):
        batch = data_rows[start : start + rows_per_chunk]
        if not batch:
            continue
        lines = [", ".join(header)] + [", ".join(row) for row in batch]
        first_row, last_row = start + 2, start + 1 + len(batch)
        sections.append(
            Section(
                content="\n".join(lines),
                metadata={"table_context": f"rows {first_row}-{last_row}"},
            )
        )
    return sections


def extract_xlsx(content: bytes, rows_per_chunk: int = ROWS_PER_TABLE_CHUNK) -> list[Section]:
    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    sections = []
    for worksheet in workbook.worksheets:
        rows = list(worksheet.iter_rows(values_only=True))
        if not rows:
            continue
        header, data_rows = rows[0], rows[1:]

        for start in range(0, len(data_rows), rows_per_chunk):
            batch = data_rows[start : start + rows_per_chunk]
            if not batch:
                continue

            def _fmt(row: tuple) -> str:
                return ", ".join(str(c) if c is not None else "" for c in row)

            lines = [_fmt(header)] + [_fmt(row) for row in batch]
            first_row, last_row = start + 2, start + 1 + len(batch)
            last_col = get_column_letter(len(header)) if header else "A"
            sections.append(
                Section(
                    content="\n".join(lines),
                    metadata={
                        "worksheet": worksheet.title,
                        "cell_range": f"A{first_row}:{last_col}{last_row}",
                        "table_context": f"rows {first_row}-{last_row}",
                    },
                )
            )
    return sections


def chunk_sections(
    sections: list[Section],
    target_tokens: int = TARGET_TOKENS,
    max_tokens_before_split: int = MAX_TOKENS_BEFORE_SPLIT,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> list[ExtractedChunk]:
    chunks: list[ExtractedChunk] = []

    def _make_chunk(text: str, section: Section) -> ExtractedChunk:
        return ExtractedChunk(
            content=text,
            page_number=section.page_number,
            section_heading=section.section_heading,
            metadata={**section.metadata, "language": detect_language(text)},
        )

    for section in sections:
        if _approx_tokens(section.content) <= max_tokens_before_split:
            chunks.append(_make_chunk(section.content, section))
            continue

        paragraphs = [p for p in section.content.split("\n\n") if p.strip()] or [
            section.content
        ]
        overlap_chars = overlap_tokens * 4
        sub_chunks: list[str] = []
        current = ""
        for para in paragraphs:
            candidate = f"{current}\n\n{para}" if current else para
            if current and _approx_tokens(candidate) > target_tokens:
                sub_chunks.append(current)
                tail = current[-overlap_chars:] if len(current) > overlap_chars else current
                current = f"{tail}\n\n{para}"
            else:
                current = candidate
        if current:
            sub_chunks.append(current)

        for sub in sub_chunks:
            chunks.append(_make_chunk(sub, section))

    return chunks


_EXTRACTORS = {
    ".pdf": extract_pdf,
    ".docx": extract_docx,
    ".txt": extract_txt,
    ".csv": extract_csv,
    ".xlsx": extract_xlsx,
}


def extract_document(ext: str, content: bytes) -> list[ExtractedChunk]:
    extractor = _EXTRACTORS.get(ext)
    if extractor is None:
        raise ValueError(f"No extractor registered for extension: {ext}")
    return chunk_sections(extractor(content))
