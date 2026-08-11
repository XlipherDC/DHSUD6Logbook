"""Convert the reference XLSX workbook into normalized issuance JSON.

This intentionally uses only the Python standard library so the migration can
be repeated without installing a spreadsheet package.
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET


NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SHEET_LABELS = {
    "DP": "Development Permit",
    "AP": "Alteration Permit",
    "CR": "Certificate of Registration",
    "LS Subdivision": "License to Sell — Subdivision",
    "LS Condo": "License to Sell — Condominium",
    "CNC": "Certificate of Non-Coverage",
    "LSA": "License to Sell Amendment",
    "REMC": "REMC",
    "AdApp": "Advertisement Approval",
    "CoNOD": "Change of Name / Owner / Developer",
    "Mortgage": "Mortgage Clearance",
}


def node_text(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return "".join(part.text or "" for part in node.iter() if part.tag.endswith("}t"))


def excel_date(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    try:
        number = float(value)
        if 20_000 < number < 80_000:
            return (datetime(1899, 12, 30) + timedelta(days=number)).date().isoformat()
    except ValueError:
        pass
    cleaned = re.sub(r"\s+", " ", value).strip()
    for pattern in (
        "%d %B %Y", "%d %b %Y", "%m/%d/%Y", "%m/%d/ %Y", "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(cleaned, pattern).date().isoformat()
        except ValueError:
            continue
    return cleaned


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def pick(row: dict[str, str], *names: str) -> str:
    lowered = {re.sub(r"[^a-z0-9]", "", key.lower()): value for key, value in row.items()}
    for name in names:
        value = lowered.get(re.sub(r"[^a-z0-9]", "", name.lower()), "")
        if value:
            return value
    return ""


def location_for(sheet: str, row: dict[str, str]) -> str:
    if sheet in {"DP", "LS Subdivision", "LS Condo"}:
        parts = [pick(row, "Barangay", "Brgy. District"), pick(row, "Municipality", "Municipality/City"), pick(row, "Province")]
        unique: list[str] = []
        for part in parts:
            if part and not any(part.lower() in item.lower() for item in unique):
                unique.append(part)
        return ", ".join(unique)
    return pick(row, "Location")


def workbook_rows(path: Path):
    with zipfile.ZipFile(path) as book:
        strings_root = ET.fromstring(book.read("xl/sharedStrings.xml"))
        strings = [node_text(item) for item in strings_root.findall("x:si", NS)]

        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        relationships = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {
            item.attrib["Id"]: item.attrib["Target"].lstrip("/").replace("xl/", "")
            for item in relationships
        }

        sheets = workbook.find("x:sheets", NS)
        if sheets is None:
            return
        for sheet in sheets:
            name = sheet.attrib["name"]
            if name not in SHEET_LABELS:
                continue
            relation_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = "xl/" + rel_targets[relation_id]
            root = ET.fromstring(book.read(target))
            rows: list[dict[str, str]] = []
            for row_node in root.findall(".//x:sheetData/x:row", NS):
                values: dict[str, str] = {}
                for cell in row_node.findall("x:c", NS):
                    column = re.match(r"[A-Z]+", cell.attrib["r"])
                    if not column:
                        continue
                    raw = cell.findtext("x:v", default="", namespaces=NS)
                    cell_type = cell.attrib.get("t")
                    if cell_type == "s" and raw:
                        raw = strings[int(raw)]
                    elif cell_type == "inlineStr":
                        raw = node_text(cell.find("x:is", NS))
                    values[column.group()] = clean(raw)
                rows.append(values)
            if not rows:
                continue
            headers = rows[0]
            for source_row, values in enumerate(rows[1:], start=2):
                record = {clean(headers.get(column, column)): value for column, value in values.items() if value}
                if not record:
                    continue
                first_column = headers.get("A", "")
                reference = values.get("A", "")
                if not reference or not first_column:
                    continue
                yield name, source_row, record


def normalize(path: Path) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for sheet, source_row, row in workbook_rows(path):
        reference = pick(row, "Dec. No", "Decision No.", "Decision No", "CR No", "LS No", "Dec No")
        if not reference:
            continue
        filed = excel_date(pick(row, "Date Filed"))
        issued = excel_date(pick(row, "Date Issued"))
        project = pick(row, "Project Name", "Name of Main Project", "Name of Project", "ProjectName", "Lot No/Survey")
        developer = pick(row, "Developer")
        owner = pick(row, "Owner")
        applicant = pick(row, "Applicant", "AuthRep") or developer or owner
        remarks = pick(row, "Remarks/Changes", "Remarks", "NatureOfAlteration")
        details = {key: value for key, value in row.items() if key not in {""} and value}
        output.append({
            "id": f"{slug(sheet)}-{slug(reference)}-{source_row}",
            "reference_number": reference,
            "issuance_type": SHEET_LABELS[sheet],
            "source_sheet": sheet,
            "source_row": source_row,
            "date_filed": filed,
            "date_issued": issued,
            "project_name": project or reference,
            "location": location_for(sheet, row),
            "applicant": applicant,
            "developer": developer,
            "owner": owner,
            "processor": pick(row, "Processor"),
            "or_number": pick(row, "OR_Number", "OR Number"),
            "remarks": remarks,
            "assigned_to": "",
            "details": details,
        })
    return output


def main() -> None:
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "reference.xlsx")
    target = Path(sys.argv[2] if len(sys.argv) > 2 else "private-data/issuances.json")
    records = normalize(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts: dict[str, int] = {}
    for record in records:
        counts[str(record["source_sheet"])] = counts.get(str(record["source_sheet"]), 0) + 1
    print(json.dumps({"records": len(records), "by_sheet": counts}, indent=2))


if __name__ == "__main__":
    main()
