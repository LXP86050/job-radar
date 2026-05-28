/**
 * DOCX builder. Exports buildDocx(data, outPath) for the tailorer;
 * runs as CLI to build the master resume when invoked directly.
 *
 * ATS-friendly: clean section headers, no tables/columns, Calibri 11pt,
 * bullets via LevelFormat.BULLET, single column.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  LevelFormat, TabStopType, TabStopPosition, BorderStyle,
} = require('docx');

const PAGE = {
  size: { width: 12240, height: 15840 }, // US Letter
  margin: { top: 720, bottom: 720, left: 864, right: 864 },
};
const gray = '333333';
const navy = '1F4E79';
const linkBlue = '0563C1';

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 40 },
    children: [new TextRun({ text, font: 'Calibri', size: 21 })],
  });
}

function section(title) {
  return new Paragraph({
    spacing: { before: 200, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: navy, space: 1 } },
    children: [new TextRun({
      text: title.toUpperCase(),
      bold: true, font: 'Calibri', size: 23, color: navy,
      characterSpacing: 20,
    })],
  });
}

function plain(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text, font: 'Calibri', size: 21, ...opts })],
  });
}

function buildChildren(data) {
  const out = [];

  // Header
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({
      text: data.name, bold: true, font: 'Calibri', size: 44, color: navy,
    })],
  }));

  const c = data.contact;
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({ text: `${c.phone}  |  `, font: 'Calibri', size: 20, color: gray }),
      new TextRun({ text: c.email, font: 'Calibri', size: 20, color: linkBlue, underline: {} }),
      new TextRun({ text: '  |  ', font: 'Calibri', size: 20, color: gray }),
      new TextRun({ text: c.linkedin, font: 'Calibri', size: 20, color: linkBlue, underline: {} }),
      new TextRun({ text: '  |  ', font: 'Calibri', size: 20, color: gray }),
      new TextRun({ text: c.github, font: 'Calibri', size: 20, color: linkBlue, underline: {} }),
      new TextRun({ text: '  |  ', font: 'Calibri', size: 20, color: gray }),
      new TextRun({ text: c.portfolio, font: 'Calibri', size: 20, color: linkBlue, underline: {}, bold: true }),
    ],
  }));

  out.push(section('Summary'));
  out.push(plain(data.summary));

  out.push(section('Core Skills'));
  for (const [cat, items] of Object.entries(data.skills)) {
    out.push(new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: `${cat}: `, bold: true, font: 'Calibri', size: 21 }),
        new TextRun({ text: items.join(', '), font: 'Calibri', size: 21 }),
      ],
    }));
  }

  out.push(section('Experience'));
  for (const j of data.experience) {
    out.push(new Paragraph({
      spacing: { before: 80, after: 20 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: j.title, bold: true, font: 'Calibri', size: 22 }),
        new TextRun({ text: '  |  ', font: 'Calibri', size: 22 }),
        new TextRun({ text: j.company, bold: true, font: 'Calibri', size: 22 }),
        new TextRun({ text: `\t${j.dates}`, italics: true, font: 'Calibri', size: 20, color: gray }),
      ],
    }));
    for (const b of j.bullets) out.push(bullet(b));
  }

  out.push(section('Projects'));
  for (const proj of data.projects) {
    out.push(new Paragraph({
      spacing: { before: 80, after: 20 },
      children: [
        new TextRun({ text: proj.name, bold: true, font: 'Calibri', size: 22 }),
        new TextRun({ text: ' | ', font: 'Calibri', size: 21 }),
        new TextRun({ text: proj.stack, italics: true, font: 'Calibri', size: 20, color: gray }),
      ],
    }));
    for (const b of proj.bullets) out.push(bullet(b));
  }

  out.push(section('Education'));
  for (const e of data.education) {
    out.push(new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: e.degree, bold: true, font: 'Calibri', size: 21 }),
        new TextRun({ text: ` — ${e.school}, ${e.year}`, font: 'Calibri', size: 21 }),
      ],
    }));
  }

  out.push(section('Certifications'));
  for (const cert of data.certifications) {
    out.push(bullet(`${cert.issuer} — ${cert.name} (${cert.date})`));
  }

  return out;
}

/**
 * @param {object} data    Resume data (defaults to ./resume-data.js)
 * @param {string} outPath Output .docx path
 * @returns {Promise<string>} the written path
 */
async function buildDocx(data, outPath) {
  if (!data) data = require('./resume-data');
  if (!outPath) outPath = path.join(__dirname, 'lokesh-pulivarthi-resume.docx');

  const doc = new Document({
    creator: data.name,
    title: `${data.name} — Resume`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 240 } } },
        }],
      }],
    },
    sections: [{
      properties: { page: PAGE },
      children: buildChildren(data),
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

module.exports = { buildDocx };

if (require.main === module) {
  buildDocx().then(p => console.log(`DOCX written: ${p}`));
}
