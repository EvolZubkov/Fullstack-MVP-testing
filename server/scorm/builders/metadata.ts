import type { Test } from "@shared/schema";
import { escapeXml } from "../utils/escape";
import { richTextToPlain } from "@shared/template/rich-text";

/**
 * PRD-59 FR-20: the catalogue text of the package.
 *
 * XML is no carrier of markup — an author's `<p>` here would arrive at the LMS as
 * escaped tag soup. What goes in is the plain projection, paragraphs intact: this
 * entry is read by a person browsing the LMS catalogue.
 */
function descriptionText(test: Test): string {
  return richTextToPlain(test.description, test.descriptionFormat) || "Assessment test";
}

export function buildMetadataXml(test: Test): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<lom xmlns="http://ltsc.ieee.org/xsd/LOM"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://ltsc.ieee.org/xsd/LOM lomStrict.xsd">
  <general>
    <identifier>
      <catalog>test</catalog>
      <entry>${test.id}</entry>
    </identifier>
    <title>
      <string language="en">${escapeXml(test.title)}</string>
    </title>
    <description>
      <string language="en">${escapeXml(descriptionText(test))}</string>
    </description>
    <language>en</language>
  </general>
  <lifeCycle>
    <version>
      <string language="en">1.0</string>
    </version>
    <status>
      <source>LOMv1.0</source>
      <value>final</value>
    </status>
  </lifeCycle>
  <technical>
    <format>text/html</format>
  </technical>
  <educational>
    <interactivityType>
      <source>LOMv1.0</source>
      <value>active</value>
    </interactivityType>
    <learningResourceType>
      <source>LOMv1.0</source>
      <value>exercise</value>
    </learningResourceType>
  </educational>
</lom>`;
}
