/**
 * Builds lokesh-pulivarthi-resume.docx from resume-data.js via docx-js.
 * Optimized for ATS parsing: clean section headers, no tables/columns,
 * Calibri 11pt, bullet lists via LevelFormat.BULLET.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  HeadingLevel, LevelFormat, TabStopType, TabStopPosition,
  BorderStyle, PageOrientation,
} = require('docx');
const data = require('./resume-data');

const OUT = path.join(__dirname, 'lokesh-pulivarthi-resume.docx');

// 1 inch = 1440 DXA; we use 0.5in top/bottom + 0.6in left/right margins
const PAGE = {
  size: { width: 12240, height: 15840 }, // US Letter
  margin: { top: 720, bottom: 720, left: 864, right: 864 },
};

const black = '000000';
const gray = '333333';

function p(opts) {
  return new Paragraph({ spacing: { after: 60 }, ...opts });
}

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
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: black, space: 1 } },
    children: [new TextRun({
      text: title.toUpperCase(),
      bold: true, font: 'Calibri', size: 23,
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

const children = [];

// Header
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 60 },
  children: [new TextRun({
    text: data.name, bold: true, font: 'Calibri', size: 44,
  })],
}));

const c = data.contact;
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  children: [new TextRun({
    text: `${c.phone}  |  ${c.email}  |  ${c.linkedin}  |  ${c.portfolio}  |  ${c.github}`,
    font: 'Calibri', size: 20, color: gray,
  })],
}));

// Summary
children.push(section('Summary'));
children.push(plain(data.summary));

// Core Skills
children.push(section('Core Skills'));
for (const [cat, items] of Object.entries(data.skills)) {
  children.push(new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${cat}: `, bold: true, font: 'Calibri', size: 21 }),
      new TextRun({ text: items.join(', '), font: 'Calibri', size: 21 }),
    ],
  }));
}

// Experience
children.push(section('Experience'));
for (const j of data.experience) {
  children.push(new Paragraph({
    spacing: { before: 80, after: 20 },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    children: [
      new TextRun({ text: j.title, bold: true, font: 'Calibri', size: 22 }),
      new TextRun({ text: '  |  ', font: 'Calibri', size: 22 }),
      new TextRun({ text: j.company, bold: true, font: 'Calibri', size: 22 }),
      new TextRun({ text: `\t${j.dates}`, italics: true, font: 'Calibri', size: 20, color: gray }),
    ],
  }));
  for (const b of j.bullets) children.push(bullet(b));
}

// Projects
children.push(section('Projects'));
for (const proj of data.projects) {
  children.push(new Paragraph({
    spacing: { before: 80, after: 20 },
    children: [
      new TextRun({ text: proj.name, bold: true, font: 'Calibri', size: 22 }),
      new TextRun({ text: ' | ', font: 'Calibri', size: 21 }),
      new TextRun({ text: proj.stack, italics: true, font: 'Calibri', size: 20, color: gray }),
    ],
  }));
  for (const b of proj.bullets) children.push(bullet(b));
}

// Education
children.push(section('Education'));
for (const e of data.education) {
  children.push(new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: e.degree, bold: true, font: 'Calibri', size: 21 }),
      new TextRun({ text: ` — ${e.school}, ${e.year}`, font: 'Calibri', size: 21 }),
    ],
  }));
}

// Certifications
children.push(section('Certifications'));
for (const cert of data.certifications) {
  children.push(bullet(`${cert.issuer} — ${cert.name} (${cert.date})`));
}

const doc = new Document({
  creator: 'Lokesh Pulivarthi',
  title: 'Lokesh Pulivarthi — Resume',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 21 } } },
  },
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
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log(`DOCX written: ${OUT}`);
});
