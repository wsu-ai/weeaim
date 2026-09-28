import io

import openpyxl
from docx import Document as DocxDocument

from app.documents.extraction import (
    Section,
    chunk_sections,
    extract_csv,
    extract_docx,
    extract_pdf,
    extract_txt,
    extract_xlsx,
)
from app.documents.language import detect_language


def _build_minimal_pdf(text: str) -> bytes:
    """Builds a spec-minimal, single-page PDF with real extractable text.

    Byte offsets in the xref table are computed here rather than hand-typed,
    since a wrong offset makes most parsers reject the file outright.
    """
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> "
        b"/MediaBox [0 0 200 200] /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream_content = f"BT /F1 24 Tf 20 100 Td ({text}) Tj ET".encode()
    objects.append(
        b"<< /Length " + str(len(stream_content)).encode() + b" >>\nstream\n"
        + stream_content
        + b"\nendstream"
    )

    buf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(buf))
        buf += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"

    xref_offset = len(buf)
    buf += f"xref\n0 {len(objects) + 1}\n".encode()
    buf += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        buf += f"{off:010d} 00000 n \n".encode()
    buf += b"trailer\n"
    buf += f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode()
    buf += b"startxref\n"
    buf += f"{xref_offset}\n".encode()
    buf += b"%%EOF"
    return bytes(buf)


def test_extract_pdf_returns_one_section_per_page_with_text():
    pdf_bytes = _build_minimal_pdf("Hello World")
    sections = extract_pdf(pdf_bytes)
    assert len(sections) == 1
    assert sections[0].page_number == 1
    assert "Hello World" in sections[0].content


def test_extract_txt_returns_whole_file_as_one_section():
    sections = extract_txt(b"Just some plain text content.")
    assert len(sections) == 1
    assert sections[0].page_number is None
    assert sections[0].content == "Just some plain text content."


def test_extract_txt_skips_empty_file():
    assert extract_txt(b"   \n  ") == []


def test_extract_docx_tracks_heading_as_section_boundary():
    doc = DocxDocument()
    doc.add_paragraph("Intro paragraph before any heading.")
    doc.add_heading("Problem", level=1)
    doc.add_paragraph("The problem is hard to solve.")
    doc.add_heading("Solution", level=1)
    doc.add_paragraph("Our solution addresses it.")
    buf = io.BytesIO()
    doc.save(buf)

    sections = extract_docx(buf.getvalue())
    assert len(sections) == 3
    assert sections[0].section_heading is None
    assert sections[1].section_heading == "Problem"
    assert "hard to solve" in sections[1].content
    assert sections[2].section_heading == "Solution"


def test_extract_csv_batches_rows_with_header_repeated():
    csv_text = "name,age\n" + "\n".join(f"person{i},{i}" for i in range(5))
    sections = extract_csv(csv_text.encode(), rows_per_chunk=2)
    assert len(sections) == 3
    assert sections[0].content.startswith("name, age")
    assert sections[0].metadata["table_context"] == "rows 2-3"
    assert sections[2].metadata["table_context"] == "rows 6-6"


def test_extract_xlsx_includes_worksheet_and_cell_range():
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"
    sheet.append(["name", "age"])
    for i in range(3):
        sheet.append([f"person{i}", i])
    buf = io.BytesIO()
    workbook.save(buf)

    sections = extract_xlsx(buf.getvalue(), rows_per_chunk=10)
    assert len(sections) == 1
    assert sections[0].metadata["worksheet"] == "Sheet1"
    assert sections[0].metadata["cell_range"] == "A2:B4"


def test_chunk_sections_keeps_short_section_as_one_chunk():
    chunks = chunk_sections([Section(content="short text", page_number=1)])
    assert len(chunks) == 1
    assert chunks[0].content == "short text"
    assert chunks[0].page_number == 1


def test_chunk_sections_splits_long_section_with_overlap():
    paragraphs = [f"Paragraph number {i} with some extra filler words to add length." for i in range(60)]
    long_text = "\n\n".join(paragraphs)
    chunks = chunk_sections([Section(content=long_text, page_number=2)], target_tokens=100, max_tokens_before_split=120)

    assert len(chunks) > 1
    assert all(chunk.page_number == 2 for chunk in chunks)
    # Overlap: the tail of one chunk should reappear at the start of the next.
    first_tail = chunks[0].content[-40:]
    assert first_tail[:20] in chunks[1].content


def test_detect_language_korean_vs_english():
    assert detect_language("이것은 한국어 문장입니다.") == "ko"
    assert detect_language("This is an English sentence.") == "en"
