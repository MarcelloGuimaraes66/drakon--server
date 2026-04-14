import JSZip from "jszip";
import {
  buildReportDocumentModel,
  type ReportChartBlock,
  type ReportDocxImageEvidence,
  type ReportDocxInput,
  type ReportDocumentModel,
  type ReportKpiCard,
  type ReportMetadataItem,
  type ReportNarrativeSection,
  type ReportTable,
  type ReportVideoCard,
} from "./reportBlocks";
import {
  REPORT_THEME,
  reportContentWidthTwips,
  reportToneFill,
  reportToneInk,
} from "./reportTheme";

export type {
  ReportChartBlock,
  ReportDocxContext,
  ReportDocxImageEvidence,
  ReportDocxInput,
  ReportDocxSection,
  ReportDocxStat,
  ReportDocxVideoEvidence,
} from "./reportBlocks";

type ReportRelationship =
  | { id: string; kind: "styles"; target: string }
  | { id: string; kind: "header"; target: string }
  | { id: string; kind: "footer"; target: string }
  | { id: string; kind: "image"; target: string }
  | { id: string; kind: "hyperlink"; target: string };

type MediaAsset = {
  key: string;
  filename: string;
  title: string;
  altText: string;
  bytes: Uint8Array;
  contentType: string;
};

type ParagraphAlignment = "left" | "center" | "right";

type RunOptions = {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  preserveSpace?: boolean;
};

type ParagraphOptions = {
  styleId?: string;
  alignment?: ParagraphAlignment;
  spacingBefore?: number;
  spacingAfter?: number;
  pageBreakBefore?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
};

type TableCellSpec = {
  content: string | string[];
  widthTwips?: number;
  shading?: string;
  verticalAlign?: "top" | "center";
  gridSpan?: number;
  noWrap?: boolean;
  marginsTwips?: number;
};

type TableCellOptions = Omit<TableCellSpec, "content">;

type TableSpec = {
  columnWidths: number[];
  rows: TableCellSpec[][];
  widthTwips?: number;
  outsideBorderColor?: string | null;
  cellMarginTwips?: number;
};

const CONTENT_WIDTH_TWIPS = reportContentWidthTwips();

function isPtLanguage(language: string | undefined): boolean {
  return typeof language === "string" && language.trim().toLowerCase().startsWith("pt");
}

function sanitizeXmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeParagraphs(values: readonly string[] | undefined): string[] {
  return Array.isArray(values)
    ? values.map((value) => normalizeText(value)).filter((value) => value.length > 0)
    : [];
}

function runPropertiesXml(options: RunOptions = {}): string {
  const parts: string[] = [];
  if (options.bold) parts.push("<w:b/>");
  if (options.italic) parts.push("<w:i/>");
  if (options.color) parts.push(`<w:color w:val="${options.color}"/>`);
  if (options.size) parts.push(`<w:sz w:val="${options.size}"/>`);
  return parts.length > 0 ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
}

function textRunXml(text: string, options: RunOptions = {}): string {
  return [
    "<w:r>",
    runPropertiesXml(options),
    `<w:t${options.preserveSpace === false ? "" : ' xml:space="preserve"'}>${sanitizeXmlText(text)}</w:t>`,
    "</w:r>",
  ].join("");
}

function rawParagraphXml(contentXml: string, options: ParagraphOptions = {}): string {
  const props: string[] = [];
  if (options.styleId) props.push(`<w:pStyle w:val="${options.styleId}"/>`);
  if (options.alignment) props.push(`<w:jc w:val="${options.alignment}"/>`);
  if (
    typeof options.spacingBefore === "number" ||
    typeof options.spacingAfter === "number"
  ) {
    const before = typeof options.spacingBefore === "number" ? options.spacingBefore : 0;
    const after = typeof options.spacingAfter === "number" ? options.spacingAfter : 0;
    props.push(`<w:spacing w:before="${before}" w:after="${after}"/>`);
  }
  if (options.pageBreakBefore) props.push("<w:pageBreakBefore/>");
  if (options.keepNext) props.push("<w:keepNext/>");
  if (options.keepLines) props.push("<w:keepLines/>");
  const propsXml = props.length > 0 ? `<w:pPr>${props.join("")}</w:pPr>` : "";
  return `<w:p>${propsXml}${contentXml}</w:p>`;
}

function paragraphXml(text: string, options: ParagraphOptions = {}, runOptions: RunOptions = {}): string {
  return rawParagraphXml(textRunXml(text, runOptions), options);
}

function emptyParagraphXml(styleId = "Normal"): string {
  return paragraphXml(" ", { styleId }, { preserveSpace: true });
}

function pageBreakXml(): string {
  return "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>";
}

function bulletParagraphXml(text: string): string {
  return rawParagraphXml(
    [textRunXml("• ", { color: REPORT_THEME.colors.accent, bold: true }), textRunXml(text)].join(""),
    { styleId: "BulletText", spacingAfter: 96 }
  );
}

function hyperlinkParagraphXml(
  label: string,
  relationshipId: string,
  options: ParagraphOptions = {}
): string {
  const content = [
    `<w:hyperlink r:id="${relationshipId}" w:history="1">`,
    "<w:r><w:rPr>",
    `<w:color w:val="${REPORT_THEME.colors.primary}"/>`,
    '<w:u w:val="single"/>',
    "</w:rPr>",
    `<w:t xml:space="preserve">${sanitizeXmlText(label)}</w:t>`,
    "</w:r></w:hyperlink>",
  ].join("");
  return rawParagraphXml(content, { styleId: "BodyText", ...options });
}

function imageXml(
  relationshipId: string,
  docPrId: number,
  title: string,
  altText: string,
  widthEmu: number,
  heightEmu: number
): string {
  const cleanTitle = sanitizeXmlText(title || `Evidence ${docPrId}`);
  const cleanAlt = sanitizeXmlText(altText || title || `Evidence ${docPrId}`);
  return [
    "<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:drawing>",
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">',
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>`,
    `<wp:docPr id="${docPrId}" name="${cleanTitle}" descr="${cleanAlt}"/>`,
    "<wp:cNvGraphicFramePr>",
    '<a:graphicFrameLocks noChangeAspect="1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
    "</wp:cNvGraphicFramePr>",
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    "<pic:nvPicPr>",
    `<pic:cNvPr id="${docPrId}" name="${cleanTitle}" descr="${cleanAlt}"/>`,
    "<pic:cNvPicPr/>",
    "</pic:nvPicPr>",
    "<pic:blipFill>",
    `<a:blip r:embed="${relationshipId}"/>`,
    "<a:stretch><a:fillRect/></a:stretch>",
    "</pic:blipFill>",
    "<pic:spPr>",
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
    "</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
  ].join("");
}

function normalizeImageExtension(contentType: string, filename: string): string {
  const normalizedType = normalizeText(contentType).toLowerCase();
  if (normalizedType === "image/svg+xml") return "svg";
  if (normalizedType === "image/png") return "png";
  if (normalizedType === "image/gif") return "gif";
  if (normalizedType === "image/webp") return "webp";
  if (normalizedType === "image/bmp" || normalizedType === "image/x-ms-bmp") return "bmp";
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") return "jpeg";
  const extension = filename.split(".").pop()?.trim().toLowerCase() || "";
  if (
    extension === "svg" ||
    extension === "png" ||
    extension === "gif" ||
    extension === "webp" ||
    extension === "bmp"
  ) {
    return extension;
  }
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  return "jpeg";
}

function buildContentTypesXml(imageExtensions: readonly string[]): string {
  const defaults = new Set<string>(["rels", "xml", ...imageExtensions]);
  const entries = Array.from(defaults)
    .sort()
    .map((extension) => {
      const type =
        extension === "rels"
          ? "application/vnd.openxmlformats-package.relationships+xml"
          : extension === "xml"
          ? "application/xml"
          : extension === "png"
          ? "image/png"
          : extension === "gif"
          ? "image/gif"
          : extension === "webp"
          ? "image/webp"
          : extension === "bmp"
          ? "image/bmp"
          : extension === "svg"
          ? "image/svg+xml"
          : "image/jpeg";
      return `<Default Extension="${extension}" ContentType="${type}"/>`;
    })
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    entries,
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    "</Types>",
  ].join("");
}

function buildPackageRelationshipsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    "</Relationships>",
  ].join("");
}

function buildStylesXml(): string {
  const bodyFont = REPORT_THEME.fonts.body;
  const displayFont = REPORT_THEME.fonts.display;
  const monoFont = REPORT_THEME.fonts.mono;

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:sz w:val="21"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:sz w:val="21"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CoverEyebrow"><w:name w:val="Cover Eyebrow"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.accent}"/><w:b/><w:caps/><w:sz w:val="18"/></w:rPr><w:pPr><w:spacing w:after="80"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CoverTitle"><w:name w:val="Cover Title"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${displayFont}" w:hAnsi="${displayFont}" w:eastAsia="${displayFont}" w:cs="${displayFont}"/><w:color w:val="${REPORT_THEME.colors.white}"/><w:b/><w:sz w:val="52"/></w:rPr><w:pPr><w:spacing w:after="140"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CoverSubtitle"><w:name w:val="Cover Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.white}"/><w:sz w:val="24"/></w:rPr><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CoverBody"><w:name w:val="Cover Body"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="D9E2EC"/><w:sz w:val="22"/></w:rPr><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="SectionHeading"><w:name w:val="Section Heading"/><w:basedOn w:val="Normal"/><w:outlineLvl w:val="1"/><w:qFormat/><w:rPr><w:rFonts w:ascii="${displayFont}" w:hAnsi="${displayFont}" w:eastAsia="${displayFont}" w:cs="${displayFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:b/><w:sz w:val="32"/></w:rPr><w:pPr><w:spacing w:before="160" w:after="120"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="SubsectionHeading"><w:name w:val="Subsection Heading"/><w:basedOn w:val="Normal"/><w:outlineLvl w:val="2"/><w:qFormat/><w:rPr><w:rFonts w:ascii="${displayFont}" w:hAnsi="${displayFont}" w:eastAsia="${displayFont}" w:cs="${displayFont}"/><w:color w:val="${REPORT_THEME.colors.primary}"/><w:b/><w:sz w:val="26"/></w:rPr><w:pPr><w:spacing w:before="120" w:after="96"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="IntroLead"><w:name w:val="Intro Lead"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:sz w:val="24"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="SmallLabel"><w:name w:val="Small Label"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.muted}"/><w:b/><w:caps/><w:sz w:val="16"/></w:rPr><w:pPr><w:spacing w:after="32"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="MetricValue"><w:name w:val="Metric Value"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${displayFont}" w:hAnsi="${displayFont}" w:eastAsia="${displayFont}" w:cs="${displayFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:b/><w:sz w:val="34"/></w:rPr><w:pPr><w:spacing w:after="32"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CardValue"><w:name w:val="Card Value"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${displayFont}" w:hAnsi="${displayFont}" w:eastAsia="${displayFont}" w:cs="${displayFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:b/><w:sz w:val="30"/></w:rPr><w:pPr><w:spacing w:after="16"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CardLabel"><w:name w:val="Card Label"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.muted}"/><w:b/><w:caps/><w:sz w:val="16"/></w:rPr><w:pPr><w:spacing w:after="24"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="CaptionText"><w:name w:val="Caption Text"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.muted}"/><w:sz w:val="18"/></w:rPr><w:pPr><w:spacing w:after="80"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.primary}"/><w:b/><w:sz w:val="18"/></w:rPr><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="TableCell"><w:name w:val="Table Cell"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:sz w:val="19"/></w:rPr><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="BulletText"><w:name w:val="Bullet Text"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.ink}"/><w:sz w:val="21"/></w:rPr><w:pPr><w:spacing w:after="80"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="HeaderText"><w:name w:val="Header Text"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:eastAsia="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${REPORT_THEME.colors.muted}"/><w:sz w:val="16"/></w:rPr><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="FooterText"><w:name w:val="Footer Text"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${monoFont}" w:hAnsi="${monoFont}" w:eastAsia="${monoFont}" w:cs="${monoFont}"/><w:color w:val="${REPORT_THEME.colors.muted}"/><w:sz w:val="16"/></w:rPr><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>`,
    "</w:styles>",
  ].join("");
}

function buildCoreXml(title: string, generatedAt: string, creator: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${sanitizeXmlText(title)}</dc:title>`,
    `<dc:creator>${sanitizeXmlText(creator)}</dc:creator>`,
    `<cp:lastModifiedBy>${sanitizeXmlText(creator)}</cp:lastModifiedBy>`,
    `<dcterms:created xsi:type="dcterms:W3CDTF">${sanitizeXmlText(generatedAt)}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${sanitizeXmlText(generatedAt)}</dcterms:modified>`,
    "</cp:coreProperties>",
  ].join("");
}

function buildAppXml(applicationName: string): string {
  const safeAppName = sanitizeXmlText(applicationName);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    `<Application>${safeAppName}</Application>`,
    "<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>",
    `<Company>${safeAppName}</Company>`,
    "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>2.0</AppVersion>",
    "</Properties>",
  ].join("");
}

function buildDocumentRelationshipsXml(relationships: readonly ReportRelationship[]): string {
  const entries = relationships
    .map((relationship) => {
      const type =
        relationship.kind === "styles"
          ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
          : relationship.kind === "header"
          ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
          : relationship.kind === "footer"
          ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
          : relationship.kind === "image"
          ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
          : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
      const targetMode = relationship.kind === "hyperlink" ? ' TargetMode="External"' : "";
      return `<Relationship Id="${relationship.id}" Type="${type}" Target="${sanitizeXmlText(relationship.target)}"${targetMode}/>`;
    })
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    entries,
    "</Relationships>",
  ].join("");
}

function buildHeaderXml(model: ReportDocumentModel): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    paragraphXml(model.header.title, { styleId: "HeaderText", spacingAfter: 0 }),
    model.header.subtitle
      ? paragraphXml(model.header.subtitle, { styleId: "CaptionText", spacingAfter: 0 })
      : "",
    "</w:hdr>",
  ].join("");
}

function footerPageFieldXml(isPt: boolean): string {
  return [
    textRunXml(isPt ? "Página " : "Page "),
    '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:color w:val="667085"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>',
    textRunXml(isPt ? " de " : " of "),
    '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:rPr><w:color w:val="667085"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>',
  ].join("");
}

function tableBorderSideXml(color: string | null): string {
  if (!color) {
    return '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>';
  }
  return [
    `<w:top w:val="single" w:sz="6" w:space="0" w:color="${color}"/>`,
    `<w:left w:val="single" w:sz="6" w:space="0" w:color="${color}"/>`,
    `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="${color}"/>`,
    `<w:right w:val="single" w:sz="6" w:space="0" w:color="${color}"/>`,
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="${color}"/>`,
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="${color}"/>`,
  ].join("");
}

function tableCellXml(content: string | string[], options: TableCellOptions = {}): string {
  const body = Array.isArray(content) ? content.join("") : content;
  const props: string[] = [];
  if (typeof options.widthTwips === "number") {
    props.push(`<w:tcW w:w="${Math.round(options.widthTwips)}" w:type="dxa"/>`);
  }
  if (typeof options.gridSpan === "number" && options.gridSpan > 1) {
    props.push(`<w:gridSpan w:val="${options.gridSpan}"/>`);
  }
  if (options.shading) {
    props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>`);
  }
  if (options.verticalAlign) {
    props.push(`<w:vAlign w:val="${options.verticalAlign}"/>`);
  }
  if (options.noWrap) {
    props.push("<w:noWrap/>");
  }
  const marginTwips = typeof options.marginsTwips === "number" ? options.marginsTwips : 120;
  props.push(
    `<w:tcMar><w:top w:w="${marginTwips}" w:type="dxa"/><w:left w:w="${marginTwips}" w:type="dxa"/><w:bottom w:w="${marginTwips}" w:type="dxa"/><w:right w:w="${marginTwips}" w:type="dxa"/></w:tcMar>`
  );
  return `<w:tc><w:tcPr>${props.join("")}</w:tcPr>${body || emptyParagraphXml()}</w:tc>`;
}

function tableXml(spec: TableSpec): string {
  const totalWidth =
    typeof spec.widthTwips === "number" ? Math.round(spec.widthTwips) : CONTENT_WIDTH_TWIPS;
  const rowsXml = spec.rows
    .map((row) => `<w:tr>${row.map((cell) => tableCellXml(cell.content, cell)).join("")}</w:tr>`)
    .join("");
  const gridXml = spec.columnWidths
    .map((width) => `<w:gridCol w:w="${Math.round(width)}"/>`)
    .join("");
  const borderXml = tableBorderSideXml(spec.outsideBorderColor ?? REPORT_THEME.colors.line);
  const cellMarginTwips = typeof spec.cellMarginTwips === "number" ? spec.cellMarginTwips : 120;
  return [
    "<w:tbl>",
    `<w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${cellMarginTwips}" w:type="dxa"/><w:left w:w="${cellMarginTwips}" w:type="dxa"/><w:bottom w:w="${cellMarginTwips}" w:type="dxa"/><w:right w:w="${cellMarginTwips}" w:type="dxa"/></w:tblCellMar><w:tblBorders>${borderXml}</w:tblBorders></w:tblPr>`,
    `<w:tblGrid>${gridXml}</w:tblGrid>`,
    rowsXml,
    "</w:tbl>",
  ].join("");
}

function buildFooterXml(model: ReportDocumentModel, isPt: boolean): string {
  const leftWidth = Math.round(CONTENT_WIDTH_TWIPS * 0.65);
  const rightWidth = CONTENT_WIDTH_TWIPS - leftWidth;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    tableXml({
      columnWidths: [leftWidth, rightWidth],
      rows: [
        [
          {
            content: paragraphXml(model.footer.leftText, {
              styleId: "FooterText",
              spacingAfter: 0,
            }),
            widthTwips: leftWidth,
            verticalAlign: "center",
            marginsTwips: 0,
          },
          {
            content: [
              model.footer.rightLabel
                ? paragraphXml(model.footer.rightLabel, {
                    styleId: "FooterText",
                    alignment: "right",
                    spacingAfter: 0,
                  })
                : "",
              rawParagraphXml(footerPageFieldXml(isPt), {
                styleId: "FooterText",
                alignment: "right",
                spacingAfter: 0,
              }),
            ].filter(Boolean),
            widthTwips: rightWidth,
            verticalAlign: "center",
            marginsTwips: 0,
          },
        ],
      ],
      outsideBorderColor: null,
      cellMarginTwips: 0,
    }),
    "</w:ftr>",
  ].join("");
}

function buildDocumentXml(
  bodyXml: string,
  headerRelationshipId: string,
  footerRelationshipId: string
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:office:office" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">',
    "<w:body>",
    bodyXml,
    `<w:sectPr><w:headerReference w:type="default" r:id="${headerRelationshipId}"/><w:footerReference w:type="default" r:id="${footerRelationshipId}"/><w:pgSz w:w="${REPORT_THEME.page.widthTwips}" w:h="${REPORT_THEME.page.heightTwips}"/><w:pgMar w:top="${REPORT_THEME.page.marginTwips}" w:right="${REPORT_THEME.page.marginTwips}" w:bottom="${REPORT_THEME.page.marginTwips}" w:left="${REPORT_THEME.page.marginTwips}" w:header="${REPORT_THEME.page.headerTwips}" w:footer="${REPORT_THEME.page.footerTwips}" w:gutter="0"/></w:sectPr>`,
    "</w:body></w:document>",
  ].join("");
}

function splitMetadataIntoRows(items: readonly ReportMetadataItem[], perRow = 2): ReportMetadataItem[][] {
  const rows: ReportMetadataItem[][] = [];
  for (let index = 0; index < items.length; index += perRow) {
    rows.push(items.slice(index, index + perRow));
  }
  return rows;
}

function renderMetadataCardRows(items: readonly ReportMetadataItem[]): string[] {
  if (items.length === 0) return [];
  const rows = splitMetadataIntoRows(items, 2);
  const halfWidth = Math.floor(CONTENT_WIDTH_TWIPS / 2);
  return rows.map((row) => {
    const cells: TableCellSpec[] = row.map((item) => ({
      content: [
        paragraphXml(item.label, { styleId: "SmallLabel", spacingAfter: 24 }),
        paragraphXml(item.value, { styleId: "MetricValue", spacingAfter: 0 }),
      ],
      widthTwips: halfWidth,
      shading: REPORT_THEME.colors.surfaceAlt,
      verticalAlign: "center" as const,
      marginsTwips: 160,
    }));
    if (cells.length < 2) {
      cells.push({
        content: emptyParagraphXml(),
        widthTwips: halfWidth,
        shading: REPORT_THEME.colors.surface,
        verticalAlign: "center",
        marginsTwips: 160,
      });
    }
    return tableXml({
      columnWidths: [halfWidth, halfWidth],
      rows: [cells],
      outsideBorderColor: REPORT_THEME.colors.line,
      cellMarginTwips: 90,
    });
  });
}

function renderMetadataStripXml(items: readonly ReportMetadataItem[]): string {
  const visible = items.slice(0, 3);
  const widths = new Array(visible.length).fill(Math.floor(CONTENT_WIDTH_TWIPS / Math.max(1, visible.length)));
  return tableXml({
    columnWidths: widths,
    rows: [
      visible.map((item, index) => ({
        content: [
          paragraphXml(item.label, { styleId: "SmallLabel", spacingAfter: 24 }),
          paragraphXml(item.value, { styleId: "CardValue", spacingAfter: 0 }),
        ],
        widthTwips: widths[index],
        shading: REPORT_THEME.colors.surfaceAlt,
        verticalAlign: "center",
        marginsTwips: 140,
      })),
    ],
    outsideBorderColor: REPORT_THEME.colors.line,
    cellMarginTwips: 90,
  });
}

function renderKpiGridXml(cards: readonly ReportKpiCard[]): string[] {
  if (cards.length === 0) return [];
  const rows: string[] = [];
  const halfWidth = Math.floor(CONTENT_WIDTH_TWIPS / 2);
  for (let index = 0; index < cards.length; index += 2) {
    const slice = cards.slice(index, index + 2);
    const cells: TableCellSpec[] = slice.map((card) => ({
      content: [
        paragraphXml(card.label, { styleId: "CardLabel", spacingAfter: 16 }),
        paragraphXml(card.value, { styleId: "CardValue", spacingAfter: 0 }),
      ],
      widthTwips: halfWidth,
      shading: reportToneFill(card.tone),
      verticalAlign: "center" as const,
      marginsTwips: 160,
    }));
    if (cells.length < 2) {
      cells.push({
        content: emptyParagraphXml(),
        widthTwips: halfWidth,
        shading: REPORT_THEME.colors.surface,
        verticalAlign: "center",
        marginsTwips: 160,
      });
    }
    rows.push(
      tableXml({
        columnWidths: [halfWidth, halfWidth],
        rows: [cells],
        outsideBorderColor: REPORT_THEME.colors.line,
        cellMarginTwips: 90,
      })
    );
  }
  return rows;
}

function renderCalloutPanelXml(title: string, body: string, findings: readonly string[]): string {
  return tableXml({
    columnWidths: [CONTENT_WIDTH_TWIPS],
    rows: [
      [
        {
          content: [
            paragraphXml(title, { styleId: "SectionHeading", spacingAfter: 100 }),
            paragraphXml(body, { styleId: "IntroLead", spacingAfter: 100 }),
            ...findings.map((finding) => bulletParagraphXml(finding)),
          ],
          widthTwips: CONTENT_WIDTH_TWIPS,
          shading: REPORT_THEME.colors.surfaceAlt,
          verticalAlign: "center",
          marginsTwips: 180,
        },
      ],
    ],
    outsideBorderColor: REPORT_THEME.colors.lineStrong,
    cellMarginTwips: 100,
  });
}

function formatChartValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  const fixed = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function renderChartSectionXml(chart: ReportChartBlock): string[] {
  if (chart.items.length === 0) return [];
  const segmentCount = 10;
  const labelWidth = Math.floor(CONTENT_WIDTH_TWIPS * 0.34);
  const barTotalWidth = Math.floor(CONTENT_WIDTH_TWIPS * 0.46);
  const segmentWidth = Math.max(120, Math.floor(barTotalWidth / segmentCount));
  const normalizedBarWidth = segmentWidth * segmentCount;
  const valueWidth = CONTENT_WIDTH_TWIPS - labelWidth - normalizedBarWidth;
  const maxValue = Math.max(chart.maxValue || 0, ...chart.items.map((item) => item.value), 1);

  const rows = chart.items.map<TableCellSpec[]>((item) => {
    const ratio = Math.max(0, Math.min(1, item.value / maxValue));
    const filledSegments =
      item.value > 0 ? Math.max(1, Math.round(ratio * segmentCount)) : 0;
    const cells: TableCellSpec[] = [
      {
        content: paragraphXml(item.label, {
          styleId: "TableCell",
          spacingAfter: 0,
        }),
        widthTwips: labelWidth,
        shading: REPORT_THEME.colors.surface,
        verticalAlign: "center",
        marginsTwips: 100,
      },
    ];

    for (let index = 0; index < segmentCount; index += 1) {
      cells.push({
        content: emptyParagraphXml(),
        widthTwips: segmentWidth,
        shading:
          index < filledSegments
            ? reportToneInk(item.tone || "primary")
            : REPORT_THEME.colors.surfaceMuted,
        verticalAlign: "center",
        marginsTwips: 48,
      });
    }

    cells.push({
      content: paragraphXml(formatChartValue(item.value), {
        styleId: "TableCell",
        alignment: "right",
        spacingAfter: 0,
      }),
      widthTwips: valueWidth,
      shading: REPORT_THEME.colors.surface,
      verticalAlign: "center",
      marginsTwips: 100,
      noWrap: true,
    });

    return cells;
  });

  return [
    paragraphXml(chart.title, { styleId: "SubsectionHeading", spacingAfter: 60 }),
    chart.caption ? paragraphXml(chart.caption, { styleId: "CaptionText" }) : "",
    tableXml({
      columnWidths: [labelWidth, ...new Array(segmentCount).fill(segmentWidth), valueWidth],
      rows,
      outsideBorderColor: REPORT_THEME.colors.line,
      cellMarginTwips: 40,
    }),
  ].filter(Boolean);
}

function renderDataTableXml(table: ReportTable): string[] {
  const weights = table.columns.map((column) => column.widthWeight || 1);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0) || 1;
  const widths = weights.map((weight) => Math.floor((weight / totalWeight) * CONTENT_WIDTH_TWIPS));
  const rows: TableCellSpec[][] = [
    table.columns.map<TableCellSpec>((column, index) => ({
      content: paragraphXml(column.label, {
        styleId: "TableHeader",
        alignment: column.align,
        spacingAfter: 0,
      }),
      widthTwips: widths[index],
      shading: REPORT_THEME.colors.primarySoft,
      verticalAlign: "center",
      marginsTwips: 110,
      noWrap: true,
    })),
    ...table.rows.map<TableCellSpec[]>((row, rowIndex) =>
      table.columns.map<TableCellSpec>((column, columnIndex) => ({
        content: paragraphXml(row[column.key] || "--", {
          styleId: "TableCell",
          alignment: column.align,
          spacingAfter: 0,
        }),
        widthTwips: widths[columnIndex],
        shading: rowIndex % 2 === 0 ? REPORT_THEME.colors.surface : REPORT_THEME.colors.surfaceAlt,
        verticalAlign: "center",
        marginsTwips: 110,
      }))
    ),
  ];
  return [
    paragraphXml(table.title, { styleId: "SubsectionHeading", spacingAfter: 50 }),
    table.caption ? paragraphXml(table.caption, { styleId: "CaptionText" }) : "",
    tableXml({
      columnWidths: widths,
      rows,
      outsideBorderColor: REPORT_THEME.colors.line,
      cellMarginTwips: 90,
    }),
  ].filter(Boolean);
}

function renderNarrativeSectionXml(section: ReportNarrativeSection): string[] {
  return [
    paragraphXml(section.title, { styleId: "SectionHeading", spacingAfter: 60 }),
    section.intro ? paragraphXml(section.intro, { styleId: "IntroLead", spacingAfter: 80 }) : "",
    ...normalizeParagraphs(section.paragraphs).map((paragraph) =>
      paragraphXml(paragraph, { styleId: "BodyText" })
    ),
    ...normalizeParagraphs(section.bullets).map((bullet) => bulletParagraphXml(bullet)),
  ].filter(Boolean);
}

function renderImageGalleryXml(
  images: readonly ReportDocxImageEvidence[],
  relationshipIdByKey: Map<string, string>,
  docPrIdRef: { value: number },
  isPt: boolean
): string[] {
  if (images.length === 0) return [];
  const rows: string[] = [
    paragraphXml(isPt ? "Galeria de evidências" : "Evidence gallery", { styleId: "SectionHeading" }),
  ];
  for (let index = 0; index < images.length; index += 2) {
    const row = images.slice(index, index + 2);
    const cells: TableCellSpec[] = row.map((image, offset) => {
      const relId = relationshipIdByKey.get(`gallery:${index + offset}`);
      const imageMarkup =
        relId &&
        imageXml(
          relId,
          docPrIdRef.value++,
          image.title,
          image.caption || image.title,
          REPORT_THEME.media.galleryWidthEmu,
          REPORT_THEME.media.galleryHeightEmu
        );
      return {
        content: [
          paragraphXml(image.title, { styleId: "SmallLabel", spacingAfter: 24 }),
          imageMarkup || emptyParagraphXml(),
          image.caption ? paragraphXml(image.caption, { styleId: "CaptionText", alignment: "center" }) : "",
        ].filter(Boolean),
        widthTwips: Math.floor(CONTENT_WIDTH_TWIPS / 2),
        shading: REPORT_THEME.colors.surfaceAlt,
        verticalAlign: "top" as const,
        marginsTwips: 140,
      };
    });
    if (cells.length < 2) {
      cells.push({
        content: emptyParagraphXml(),
        widthTwips: Math.floor(CONTENT_WIDTH_TWIPS / 2),
        shading: REPORT_THEME.colors.surface,
        verticalAlign: "top",
        marginsTwips: 140,
      });
    }
    rows.push(
      tableXml({
        columnWidths: [Math.floor(CONTENT_WIDTH_TWIPS / 2), Math.floor(CONTENT_WIDTH_TWIPS / 2)],
        rows: [cells],
        outsideBorderColor: REPORT_THEME.colors.line,
        cellMarginTwips: 90,
      })
    );
  }
  return rows;
}

function renderVideoCardsXml(
  videos: readonly ReportVideoCard[],
  hyperlinkIdByKey: Map<string, string>,
  isPt: boolean
): string[] {
  if (videos.length === 0) return [];
  const rows: string[] = [
    paragraphXml(isPt ? "Vídeos relacionados" : "Related videos", { styleId: "SectionHeading" }),
  ];
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const downloadRelId = hyperlinkIdByKey.get(`video:${index}`);
    const summaryValue =
      normalizeText(video.sourceLabel) ||
      normalizeText(video.filename) ||
      normalizeText(video.title) ||
      (isPt ? "Arquivo associado" : "Linked file");
    const summary: string[] = [
      paragraphXml(isPt ? "Arquivo associado" : "Linked file", {
        styleId: "SmallLabel",
        spacingAfter: 24,
      }),
      paragraphXml(summaryValue, { styleId: "CardValue", spacingAfter: 24 }),
    ];
    if (video.detectedAt) {
      summary.push(
        paragraphXml(
          `${isPt ? "Registrado em" : "Captured at"}: ${video.detectedAt}`,
          { styleId: "CaptionText", spacingAfter: 0 }
        )
      );
    }
    const details: string[] = [
      paragraphXml(video.title, { styleId: "SubsectionHeading", spacingAfter: 40 }),
    ];
    if (video.caption) details.push(paragraphXml(video.caption, { styleId: "BodyText" }));
    if (video.detectedAt) {
      details.push(paragraphXml(`${isPt ? "Registrado em" : "Captured at"}: ${video.detectedAt}`, { styleId: "CaptionText" }));
    }
    if (video.localPath) {
      details.push(paragraphXml(`${isPt ? "Caminho local" : "Local path"}: ${video.localPath}`, { styleId: "CaptionText" }));
    }
    if (video.downloadUrl && downloadRelId) {
      details.push(hyperlinkParagraphXml(isPt ? "Abrir arquivo associado" : "Open linked file", downloadRelId, { spacingAfter: 0 }));
    }
    rows.push(
      tableXml({
        columnWidths: [Math.floor(CONTENT_WIDTH_TWIPS * 0.36), Math.floor(CONTENT_WIDTH_TWIPS * 0.64)],
        rows: [
          [
            {
              content: summary,
              widthTwips: Math.floor(CONTENT_WIDTH_TWIPS * 0.36),
              shading: REPORT_THEME.colors.accentSoft,
              verticalAlign: "center",
              marginsTwips: 140,
            },
            {
              content: details,
              widthTwips: Math.floor(CONTENT_WIDTH_TWIPS * 0.64),
              shading: REPORT_THEME.colors.surfaceAlt,
              verticalAlign: "center",
              marginsTwips: 140,
            },
          ],
        ],
        outsideBorderColor: REPORT_THEME.colors.line,
        cellMarginTwips: 80,
      })
    );
  }
  return rows;
}

function renderAppendixXml(
  model: ReportDocumentModel,
  isPt: boolean,
  hyperlinkIdByKey: Map<string, string>
): string[] {
  const rows: string[] = [paragraphXml(model.appendix.title, { styleId: "SectionHeading" })];
  if (model.appendix.items.length > 0) {
    rows.push(paragraphXml(isPt ? "Contexto e rastreabilidade" : "Context and traceability", { styleId: "SubsectionHeading" }));
    rows.push(...renderMetadataCardRows(model.appendix.items.slice(0, 6)));
  }
  if (model.appendix.limitations.length > 0) {
    rows.push(paragraphXml(isPt ? "Limitações declaradas" : "Declared limitations", { styleId: "SubsectionHeading" }));
    rows.push(...model.appendix.limitations.map((limitation) => bulletParagraphXml(limitation)));
  }
  if (model.appendix.mediaLocations.length > 0) {
    const mediaTable: ReportTable = {
      title: isPt ? "Localização de evidências" : "Evidence locations",
      caption: isPt ? "Caminhos locais e links conhecidos para auditoria." : "Known local paths and links for audit purposes.",
      columns: [
        { key: "kind", label: isPt ? "Tipo" : "Type", widthWeight: 1.1, align: "center" },
        { key: "title", label: isPt ? "Título" : "Title", widthWeight: 2.7 },
        { key: "location", label: isPt ? "Local / link" : "Location / link", widthWeight: 4.2 },
      ],
      rows: model.appendix.mediaLocations.map((item) => ({
        kind: item.kind === "video" ? (isPt ? "Vídeo" : "Video") : isPt ? "Imagem" : "Image",
        title: item.title,
        location: item.localPath || item.downloadUrl || "—",
      })),
    };
    rows.push(...renderDataTableXml(mediaTable));
    const linkedItems = model.appendix.mediaLocations
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.downloadUrl);
    if (linkedItems.length > 0) {
      rows.push(paragraphXml(isPt ? "Links rápidos" : "Quick links", { styleId: "SubsectionHeading" }));
      for (const entry of linkedItems) {
        const relId = hyperlinkIdByKey.get(`appendix:${entry.index}`);
        if (!relId) continue;
        rows.push(hyperlinkParagraphXml(entry.item.title, relId));
      }
    }
  }
  return rows;
}

function fileUrlFromPath(localPath: string): string {
  const normalized = localPath.replace(/\\/g, "/");
  const prefixed = /^[a-zA-Z]:\//.test(normalized) ? `/${normalized}` : normalized;
  return `file://${encodeURI(prefixed)}`;
}

function normalizeExternalLinkTarget(downloadUrl?: string, localPath?: string): string | null {
  const resolvedDownloadUrl = normalizeText(downloadUrl);
  if (resolvedDownloadUrl) return resolvedDownloadUrl;
  const resolvedLocalPath = normalizeText(localPath);
  if (resolvedLocalPath) return fileUrlFromPath(resolvedLocalPath);
  return null;
}

function buildMediaAssets(model: ReportDocumentModel): MediaAsset[] {
  const galleryAssets = model.evidence.imageGallery.map((image, index) => ({
    key: `gallery:${index}`,
    filename: `evidence-image-${index + 1}.${normalizeImageExtension(image.contentType, image.filename)}`,
    title: image.title,
    altText: image.caption || image.title,
    bytes: image.bytes,
    contentType: image.contentType,
  }));
  return [...galleryAssets];
}

export async function buildReportDocxBuffer(input: ReportDocxInput): Promise<Uint8Array> {
  const model = buildReportDocumentModel(input);
  const title = normalizeText(input.title, "Generated report");
  const generatedAt = normalizeText(input.generatedAt, new Date().toISOString());
  const isPt = isPtLanguage(input.context?.replyLanguage);
  const zip = new JSZip();

  const relationships: ReportRelationship[] = [
    { id: "rId1", kind: "styles", target: "styles.xml" },
    { id: "rId2", kind: "header", target: "header1.xml" },
    { id: "rId3", kind: "footer", target: "footer1.xml" },
  ];

  const mediaAssets = buildMediaAssets(model);
  const imageExtensions: string[] = [];
  let nextRelationshipId = 4;
  let nextDocPrId = 1;
  const relationshipIdByKey = new Map<string, string>();
  const hyperlinkIdByKey = new Map<string, string>();

  for (const asset of mediaAssets) {
    const extension = normalizeImageExtension(asset.contentType, asset.filename);
    const relationshipId = `rId${nextRelationshipId++}`;
    const target = `media/${asset.filename}`;
    imageExtensions.push(extension);
    relationships.push({ id: relationshipId, kind: "image", target });
    relationshipIdByKey.set(asset.key, relationshipId);
    zip.file(`word/${target}`, asset.bytes);
  }

  for (let index = 0; index < model.evidence.videoCards.length; index += 1) {
    const video = model.evidence.videoCards[index];
    const target = normalizeExternalLinkTarget(video.downloadUrl, video.localPath);
    if (!target) continue;
    const relationshipId = `rId${nextRelationshipId++}`;
    relationships.push({ id: relationshipId, kind: "hyperlink", target });
    hyperlinkIdByKey.set(`video:${index}`, relationshipId);
  }

  for (let index = 0; index < model.appendix.mediaLocations.length; index += 1) {
    const item = model.appendix.mediaLocations[index];
    const target = normalizeExternalLinkTarget(item.downloadUrl, item.localPath);
    if (!target) continue;
    const key = `appendix:${index}`;
    if (hyperlinkIdByKey.has(key)) continue;
    const relationshipId = `rId${nextRelationshipId++}`;
    relationships.push({ id: relationshipId, kind: "hyperlink", target });
    hyperlinkIdByKey.set(key, relationshipId);
  }

  const bodyParts: string[] = [];
  bodyParts.push(
    tableXml({
      columnWidths: [CONTENT_WIDTH_TWIPS],
      rows: [
        [
          {
            content: [
              paragraphXml(model.cover.eyebrow, { styleId: "CoverEyebrow", spacingAfter: 80 }),
              paragraphXml(model.cover.title, { styleId: "CoverTitle", spacingAfter: 120 }),
              model.cover.subtitle
                ? paragraphXml(model.cover.subtitle, { styleId: "CoverSubtitle", spacingAfter: 140 })
                : "",
              model.cover.summary
                ? paragraphXml(model.cover.summary, { styleId: "CoverBody", spacingAfter: 80 })
                : "",
            ].filter(Boolean),
            widthTwips: CONTENT_WIDTH_TWIPS,
            shading: REPORT_THEME.colors.surfaceStrong,
            verticalAlign: "center",
            marginsTwips: 220,
          },
        ],
      ],
      outsideBorderColor: REPORT_THEME.colors.surfaceStrong,
      cellMarginTwips: 120,
    })
  );
  bodyParts.push(...renderMetadataCardRows(model.cover.metadata));
  bodyParts.push(pageBreakXml());

  if (model.metadataStrip.length > 0) {
    bodyParts.push(renderMetadataStripXml(model.metadataStrip));
    bodyParts.push(emptyParagraphXml());
  }

  bodyParts.push(
    renderCalloutPanelXml(
      model.executiveSummary.title,
      model.executiveSummary.summary,
      model.executiveSummary.findings
    )
  );

  if (model.kpis.length > 0) {
    bodyParts.push(paragraphXml(isPt ? "Painel de KPIs" : "KPI panel", { styleId: "SectionHeading" }));
    bodyParts.push(...renderKpiGridXml(model.kpis));
  }

  if (model.charts.length > 0) {
    bodyParts.push(paragraphXml(isPt ? "Visualizações" : "Visualizations", { styleId: "SectionHeading" }));
    for (const chart of model.charts) {
      bodyParts.push(...renderChartSectionXml(chart));
    }
  }

  if (model.tables.length > 0) {
    bodyParts.push(paragraphXml(isPt ? "Quadros analíticos" : "Analytical tables", { styleId: "SectionHeading" }));
    for (const table of model.tables) {
      bodyParts.push(...renderDataTableXml(table));
    }
  }

  for (const section of model.sections) {
    bodyParts.push(...renderNarrativeSectionXml(section));
  }

  if (model.evidence.imageGallery.length > 0) {
    bodyParts.push(...renderImageGalleryXml(model.evidence.imageGallery, relationshipIdByKey, { value: nextDocPrId }, isPt));
    nextDocPrId += model.evidence.imageGallery.length;
  }

  if (model.evidence.videoCards.length > 0) {
    bodyParts.push(...renderVideoCardsXml(model.evidence.videoCards, hyperlinkIdByKey, isPt));
  }

  bodyParts.push(...renderAppendixXml(model, isPt, hyperlinkIdByKey));

  const issuerMetadata = model.cover.metadata.find((item) =>
    item.label.toLowerCase().includes("emit") || item.label.toLowerCase().includes("issue")
  );
  const creator = issuerMetadata?.value
    ? `${issuerMetadata.value} via ${normalizeText(input.context?.applicationName, "Perceptrum Chat")}`
    : normalizeText(input.context?.applicationName, "Perceptrum Chat");

  zip.file("[Content_Types].xml", buildContentTypesXml(imageExtensions));
  zip.folder("_rels")?.file(".rels", buildPackageRelationshipsXml());
  zip.folder("docProps")?.file("core.xml", buildCoreXml(title, generatedAt, creator));
  zip
    .folder("docProps")
    ?.file("app.xml", buildAppXml(normalizeText(input.context?.applicationName, "Perceptrum Chat")));
  zip.folder("word")?.file("styles.xml", buildStylesXml());
  zip.folder("word")?.file("header1.xml", buildHeaderXml(model));
  zip.folder("word")?.file("footer1.xml", buildFooterXml(model, isPt));
  zip
    .folder("word")
    ?.file("document.xml", buildDocumentXml(bodyParts.filter(Boolean).join(""), "rId2", "rId3"));
  zip
    .folder("word")
    ?.folder("_rels")
    ?.file("document.xml.rels", buildDocumentRelationshipsXml(relationships));

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}
