import JSZip from "jszip";

export interface ReportDocxStat {
  label: string;
  value: string;
}

export interface ReportDocxSection {
  heading: string;
  paragraphs: string[];
  bullets: string[];
}

export interface ReportDocxImageEvidence {
  filename: string;
  title: string;
  caption?: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface ReportDocxVideoEvidence {
  title: string;
  caption?: string;
  downloadUrl?: string;
  filename?: string;
}

export interface ReportDocxInput {
  title: string;
  generatedAt?: string;
  reportKind?: string;
  requestedQuery?: string;
  summary?: string;
  stats?: ReportDocxStat[];
  sections: ReportDocxSection[];
  images?: ReportDocxImageEvidence[];
  videos?: ReportDocxVideoEvidence[];
}

type ReportRelationship =
  | {
      id: string;
      kind: "styles";
      target: string;
    }
  | {
      id: string;
      kind: "image";
      target: string;
    }
  | {
      id: string;
      kind: "hyperlink";
      target: string;
    };

const FIXED_IMAGE_WIDTH_EMU = 5_200_000;
const FIXED_IMAGE_HEIGHT_EMU = 2_925_000;

function sanitizeXmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeParagraphs(values: readonly string[] | undefined): string[] {
  return Array.isArray(values)
    ? values
        .map((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""))
        .filter((value) => value.length > 0)
    : [];
}

function paragraphXml(text: string): string {
  return [
    "<w:p>",
    "<w:r>",
    `<w:t xml:space="preserve">${sanitizeXmlText(text)}</w:t>`,
    "</w:r>",
    "</w:p>",
  ].join("");
}

function headingXml(text: string, level: 1 | 2): string {
  const styleId = level === 1 ? "Heading1" : "Heading2";
  return [
    "<w:p>",
    "<w:pPr>",
    `<w:pStyle w:val="${styleId}"/>`,
    "</w:pPr>",
    "<w:r>",
    `<w:t xml:space="preserve">${sanitizeXmlText(text)}</w:t>`,
    "</w:r>",
    "</w:p>",
  ].join("");
}

function spacerXml(): string {
  return [
    "<w:p>",
    "<w:r>",
    '<w:t xml:space="preserve"> </w:t>',
    "</w:r>",
    "</w:p>",
  ].join("");
}

function bulletXml(text: string): string {
  return paragraphXml(`- ${text}`);
}

function hyperlinkXml(label: string, relationshipId: string): string {
  return [
    "<w:p>",
    `<w:hyperlink r:id="${relationshipId}">`,
    "<w:r>",
    "<w:rPr>",
    '<w:color w:val="0563C1"/>',
    '<w:u w:val="single"/>',
    "</w:rPr>",
    `<w:t xml:space="preserve">${sanitizeXmlText(label)}</w:t>`,
    "</w:r>",
    "</w:hyperlink>",
    "</w:p>",
  ].join("");
}

function imageXml(
  relationshipId: string,
  docPrId: number,
  title: string,
  altText: string
): string {
  const cleanTitle = sanitizeXmlText(title || `Evidence ${docPrId}`);
  const cleanAlt = sanitizeXmlText(altText || title || `Evidence ${docPrId}`);

  return [
    "<w:p>",
    "<w:r>",
    "<w:drawing>",
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">',
    `<wp:extent cx="${FIXED_IMAGE_WIDTH_EMU}" cy="${FIXED_IMAGE_HEIGHT_EMU}"/>`,
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
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${FIXED_IMAGE_WIDTH_EMU}" cy="${FIXED_IMAGE_HEIGHT_EMU}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
    "</pic:spPr>",
    "</pic:pic>",
    "</a:graphicData>",
    "</a:graphic>",
    "</wp:inline>",
    "</w:drawing>",
    "</w:r>",
    "</w:p>",
  ].join("");
}

function normalizeImageExtension(contentType: string, filename: string): string {
  const normalizedType = contentType.trim().toLowerCase();
  if (normalizedType === "image/png") return "png";
  if (normalizedType === "image/gif") return "gif";
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") return "jpeg";

  const extension = filename.split(".").pop()?.trim().toLowerCase() || "";
  if (extension === "png" || extension === "gif") return extension;
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  return "jpeg";
}

function buildContentTypesXml(imageExtensions: readonly string[]): string {
  const defaults = new Set<string>(["rels", "xml", ...imageExtensions]);
  const defaultEntries = Array.from(defaults)
    .sort()
    .map((extension) => {
      const contentType =
        extension === "rels"
          ? "application/vnd.openxmlformats-package.relationships+xml"
          : extension === "xml"
          ? "application/xml"
          : extension === "png"
          ? "image/png"
          : extension === "gif"
          ? "image/gif"
          : "image/jpeg";
      return `<Default Extension="${extension}" ContentType="${contentType}"/>`;
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    defaultEntries,
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
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
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>',
    "</w:styles>",
  ].join("");
}

function buildCoreXml(title: string, generatedAt: string): string {
  const escapedTitle = sanitizeXmlText(title);
  const escapedGeneratedAt = sanitizeXmlText(generatedAt);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${escapedTitle}</dc:title>`,
    "<dc:creator>Perceptrum Chat</dc:creator>",
    "<cp:lastModifiedBy>Perceptrum Chat</cp:lastModifiedBy>",
    `<dcterms:created xsi:type="dcterms:W3CDTF">${escapedGeneratedAt}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${escapedGeneratedAt}</dcterms:modified>`,
    "</cp:coreProperties>",
  ].join("");
}

function buildAppXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    "<Application>Perceptrum Chat</Application>",
    "<DocSecurity>0</DocSecurity>",
    "<ScaleCrop>false</ScaleCrop>",
    "<Company>Perceptrum</Company>",
    "<LinksUpToDate>false</LinksUpToDate>",
    "<SharedDoc>false</SharedDoc>",
    "<HyperlinksChanged>false</HyperlinksChanged>",
    "<AppVersion>1.0</AppVersion>",
    "</Properties>",
  ].join("");
}

function buildDocumentRelationshipsXml(relationships: readonly ReportRelationship[]): string {
  const relationshipEntries = relationships
    .map((relationship) => {
      const type =
        relationship.kind === "styles"
          ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
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
    relationshipEntries,
    "</Relationships>",
  ].join("");
}

function buildDocumentXml(bodyXml: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">',
    "<w:body>",
    bodyXml,
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
    "</w:body>",
    "</w:document>",
  ].join("");
}

export async function buildReportDocxBuffer(input: ReportDocxInput): Promise<Uint8Array> {
  const zip = new JSZip();
  const title = input.title.trim() || "Generated report";
  const generatedAt = input.generatedAt?.trim() || new Date().toISOString();
  const sections = input.sections
    .map((section) => ({
      heading: section.heading.trim(),
      paragraphs: normalizeParagraphs(section.paragraphs),
      bullets: normalizeParagraphs(section.bullets),
    }))
    .filter(
      (section) =>
        section.heading.length > 0 || section.paragraphs.length > 0 || section.bullets.length > 0
    );
  const stats = (input.stats || [])
    .map((stat) => ({
      label: stat.label.trim(),
      value: stat.value.trim(),
    }))
    .filter((stat) => stat.label.length > 0 && stat.value.length > 0);
  const images = (input.images || []).filter((image) => image.bytes && image.bytes.length > 0);
  const videos = (input.videos || []).filter(
    (video) =>
      video.title.trim().length > 0 ||
      (typeof video.downloadUrl === "string" && video.downloadUrl.trim().length > 0)
  );

  const relationships: ReportRelationship[] = [
    {
      id: "rId1",
      kind: "styles",
      target: "styles.xml",
    },
  ];
  const imageExtensions: string[] = [];
  let nextRelationshipId = 2;
  let nextDocPrId = 1;
  const relationshipIdForImage = new Map<number, string>();
  const relationshipIdForVideo = new Map<number, string>();

  images.forEach((image, index) => {
    const extension = normalizeImageExtension(image.contentType, image.filename);
    const relationshipId = `rId${nextRelationshipId++}`;
    const target = `media/evidence-image-${index + 1}.${extension}`;
    imageExtensions.push(extension);
    relationships.push({
      id: relationshipId,
      kind: "image",
      target,
    });
    relationshipIdForImage.set(index, relationshipId);
    zip.file(`word/${target}`, image.bytes);
  });

  videos.forEach((video, index) => {
    const downloadUrl = video.downloadUrl?.trim();
    if (!downloadUrl) return;
    const relationshipId = `rId${nextRelationshipId++}`;
    relationships.push({
      id: relationshipId,
      kind: "hyperlink",
      target: downloadUrl,
    });
    relationshipIdForVideo.set(index, relationshipId);
  });

  const bodyParts: string[] = [];
  bodyParts.push(headingXml(title, 1));

  if (input.summary?.trim()) {
    bodyParts.push(paragraphXml(input.summary.trim()));
  }

  if (input.reportKind?.trim()) {
    bodyParts.push(paragraphXml(`Report type: ${input.reportKind.trim()}`));
  }

  if (input.requestedQuery?.trim()) {
    bodyParts.push(paragraphXml(`Requested question: ${input.requestedQuery.trim()}`));
  }

  bodyParts.push(paragraphXml(`Generated at: ${generatedAt}`));

  if (stats.length > 0) {
    bodyParts.push(spacerXml());
    bodyParts.push(headingXml("Key metrics", 2));
    stats.forEach((stat) => {
      bodyParts.push(bulletXml(`${stat.label}: ${stat.value}`));
    });
  }

  if (sections.length > 0) {
    sections.forEach((section) => {
      bodyParts.push(spacerXml());
      if (section.heading) {
        bodyParts.push(headingXml(section.heading, 2));
      }
      section.paragraphs.forEach((paragraph) => {
        bodyParts.push(paragraphXml(paragraph));
      });
      section.bullets.forEach((bullet) => {
        bodyParts.push(bulletXml(bullet));
      });
    });
  }

  if (images.length > 0) {
    bodyParts.push(spacerXml());
    bodyParts.push(headingXml("Image evidence", 2));
    images.forEach((image, index) => {
      const relationshipId = relationshipIdForImage.get(index);
      if (!relationshipId) return;
      bodyParts.push(paragraphXml(image.title.trim() || `Evidence image ${index + 1}`));
      bodyParts.push(
        imageXml(
          relationshipId,
          nextDocPrId++,
          image.title.trim() || `Evidence image ${index + 1}`,
          image.caption?.trim() || image.title.trim() || `Evidence image ${index + 1}`
        )
      );
      if (image.caption?.trim()) {
        bodyParts.push(paragraphXml(image.caption.trim()));
      }
    });
  }

  if (videos.length > 0) {
    bodyParts.push(spacerXml());
    bodyParts.push(headingXml("Video evidence", 2));
    videos.forEach((video, index) => {
      const titleText = video.title.trim() || video.filename?.trim() || `Evidence video ${index + 1}`;
      const relationshipId = relationshipIdForVideo.get(index);
      bodyParts.push(paragraphXml(titleText));
      if (video.caption?.trim()) {
        bodyParts.push(paragraphXml(video.caption.trim()));
      }
      if (relationshipId) {
        bodyParts.push(hyperlinkXml(`Open download link for ${titleText}`, relationshipId));
      }
    });
  }

  zip.file("[Content_Types].xml", buildContentTypesXml(imageExtensions));
  zip.folder("_rels")?.file(".rels", buildPackageRelationshipsXml());
  zip.folder("docProps")?.file("core.xml", buildCoreXml(title, generatedAt));
  zip.folder("docProps")?.file("app.xml", buildAppXml());
  zip.folder("word")?.file("styles.xml", buildStylesXml());
  zip.folder("word")?.file("document.xml", buildDocumentXml(bodyParts.join("")));
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", buildDocumentRelationshipsXml(relationships));

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}
