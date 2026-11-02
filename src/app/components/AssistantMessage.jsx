import { Fragment } from "react";
import { parseAssistantMessage } from "../utils/assistantMessage.js";

function InlineText({ value = "" }) {
  const parts = value.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-[#F1F5F5] px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{part.replace(/\\([\\`*_{}\[\]()#+.!|-])/g, "$1")}</Fragment>;
  });
}

export function AssistantMessage({ content = "" }) {
  const blocks = parseAssistantMessage(content);
  return <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
    {blocks.map((block, index) => {
      if (block.type === "heading") {
        const Tag = block.level === 1 ? "h3" : "h4";
        return <Tag key={index} className="font-semibold leading-6 text-[#20343B]"><InlineText value={block.text} /></Tag>;
      }
      if (block.type === "ul" || block.type === "ol") {
        const Tag = block.type;
        return <Tag key={index} className={`${block.type === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5`}>
          {block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-0.5"><InlineText value={item} /></li>)}
        </Tag>;
      }
      if (block.type === "table") {
        return <div key={index} role="list" aria-label="Service details" className="space-y-3">
          {block.rows.map((row, rowIndex) => <section key={rowIndex} role="listitem" className="rounded-xl bg-[#F7FAFA] p-3">
            <h4 className="font-semibold text-[#20343B]"><InlineText value={row.title} /></h4>
            <div className="mt-1.5 space-y-1.5">
              {row.details.map((detail, detailIndex) => {
                const services = /service/i.test(detail.label) ? detail.value.split(/,\s*/).filter(Boolean) : null;
                return <div key={detailIndex} className="text-sm leading-6">
                  {detail.label && <span className="font-medium">{detail.label}: </span>}
                  {services?.length > 1
                    ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{services.map((service, serviceIndex) => <li key={serviceIndex}><InlineText value={service} /></li>)}</ul>
                    : <InlineText value={detail.value} />}
                </div>;
              })}
            </div>
          </section>)}
        </div>;
      }
      return <p key={index} className="whitespace-pre-wrap leading-6"><InlineText value={block.text} /></p>;
    })}
  </div>;
}
