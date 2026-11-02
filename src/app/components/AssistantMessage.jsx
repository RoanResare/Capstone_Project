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
        return <div key={index} role="list" aria-label="Service details" className="divide-y divide-[#E5EEEE]">
          {block.rows.map((row, rowIndex) => {
            const prices = row.details.filter((detail) => /price/i.test(detail.label));
            const otherDetails = row.details.filter((detail) => !/price/i.test(detail.label));
            return <div key={rowIndex} role="listitem" className="min-w-0 py-2 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <h4 className="min-w-0 font-semibold text-[#20343B]"><InlineText value={row.title} /></h4>
              {prices.map((price, priceIndex) => <span key={priceIndex} className="shrink-0 text-right text-sm font-semibold text-[#36555B]">
                {price.label && <span className="font-normal">{price.label}: </span>}<InlineText value={price.value} />
              </span>)}
            </div>
            {otherDetails.length > 0 && <div className="mt-1 space-y-1">
              {otherDetails.map((detail, detailIndex) => {
                const services = /service/i.test(detail.label) ? detail.value.split(/,\s*/).filter(Boolean) : null;
                return <div key={detailIndex} className="text-sm leading-6">
                  {detail.label && <span className="font-medium">{detail.label}: </span>}
                  {services?.length > 1
                    ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{services.map((service, serviceIndex) => <li key={serviceIndex}><InlineText value={service} /></li>)}</ul>
                    : <InlineText value={detail.value} />}
                </div>;
              })}
            </div>}
          </div>;
          })}
        </div>;
      }
      return <p key={index} className="whitespace-pre-wrap leading-6"><InlineText value={block.text} /></p>;
    })}
  </div>;
}
