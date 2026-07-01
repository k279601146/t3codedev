import { Children, Fragment, cloneElement, isValidElement, type ReactNode } from "react";
import type { ServerProviderSkill } from "@t3tools/contracts";

import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import {
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
  SKILL_CHIP_ICON_SVG,
} from "../composerInlineChip";

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;
const TECHNICAL_INLINE_TOKEN_REGEX =
  /https?:\/\/[^\s"'`<>)\]]+|\b(?:(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?::\d{1,5})?|[A-Z][A-Z0-9_]{2,}|[A-Za-z_$][\w$]*(?:[._:-][A-Za-z0-9_$][\w$-]*)+|[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*|[A-Za-z_$][\w$]*(?:Path|Url|URL|Uri|URI|Id|ID|Key|Token|Schema|Config|Port|Host|JWT|CLI|API))\b/g;

type InlineSkill = Pick<ServerProviderSkill, "name" | "displayName">;

function renderTechnicalInlineText(text: string, keyPrefix: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  TECHNICAL_INLINE_TOKEN_REGEX.lastIndex = 0;
  for (const match of text.matchAll(TECHNICAL_INLINE_TOKEN_REGEX)) {
    const token = match[0];
    const start = match.index ?? -1;
    if (start < 0 || text[start - 1] === "$") {
      continue;
    }
    const end = start + token.length;

    if (start > cursor) {
      nodes.push(text.slice(cursor, start));
    }
    nodes.push(<code key={`${keyPrefix}:technical:${start}`}>{token}</code>);
    cursor = end;
  }

  if (cursor === 0) {
    return text;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return <Fragment key={`${keyPrefix}:technical-fragment`}>{nodes}</Fragment>;
}

export function SkillInlineText(props: {
  text: string;
  skills: ReadonlyArray<InlineSkill>;
  renderUnknownSkills?: boolean;
}) {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of props.text.matchAll(SKILL_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const rawText = `$${name}`;
    const skill =
      props.skills.find((candidate) => candidate.name === name) ??
      (props.renderUnknownSkills ? { name } : null);
    if (!skill) {
      continue;
    }

    if (start > cursor) {
      nodes.push(
        renderTechnicalInlineText(props.text.slice(cursor, start), `skill-text:${cursor}`),
      );
    }
    nodes.push(<SkillChip key={`${start}:${name}`} skill={skill} rawText={rawText} />);
    cursor = start + rawText.length;
  }

  if (cursor === 0) {
    return <>{renderTechnicalInlineText(props.text, "skill-text:all")}</>;
  }
  if (cursor < props.text.length) {
    nodes.push(renderTechnicalInlineText(props.text.slice(cursor), `skill-text:${cursor}`));
  }
  return <>{nodes}</>;
}

export function renderSkillInlineMarkdownChildren(
  children: ReactNode,
  skills: ReadonlyArray<InlineSkill>,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return <SkillInlineText text={child} skills={skills} />;
    }
    if (!isValidElement<{ children?: ReactNode }>(child)) {
      return child;
    }
    if (child.type === "code" || child.type === "a") {
      return child;
    }
    if (!("children" in child.props)) {
      return child;
    }
    return cloneElement(
      child,
      undefined,
      renderSkillInlineMarkdownChildren(child.props.children, skills),
    );
  });
}

function SkillChip(props: { skill: InlineSkill; rawText: string }) {
  return (
    <span className="inline-flex align-middle leading-none">
      <span className="sr-only">{props.rawText}</span>
      <span aria-hidden="true" className={COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME}>
        <span
          aria-hidden="true"
          className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
          dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
        />
        <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>
          {formatProviderSkillDisplayName(props.skill)}
        </span>
      </span>
    </span>
  );
}
