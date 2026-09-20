import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cx } from '~/components/ui/primitives'

/** What the assistant writes, drawn as what it meant.
 *
 *  The model answers in Markdown — it was asked to use a table when comparing
 *  rows, and it does. Printed raw, a comparison of three months arrives as a
 *  wall of pipes and asterisks, which is worse than no table at all.
 *
 *  `react-markdown` rather than a regex pass or `marked` plus a sanitiser: it
 *  builds React elements and never touches `dangerouslySetInnerHTML`, so there
 *  is no HTML string anywhere in the path. That matters more here than in most
 *  places — what it renders contains customer names and notes typed by people,
 *  carried through a model, and neither of those is a trusted source of markup.
 *
 *  Every element is restyled. The defaults are a browser's, sized for an
 *  article; these are sized for a 13px bubble in a 560px panel. */
export function Markdown({ text, inverted }: { text: string; inverted?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      /** No `rehypeRaw`. HTML inside the model's answer stays text — there is
       *  no case where the assistant needs to emit markup, and every case
       *  where it could would be somebody else's markup coming back out. */
      components={{
        p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,

        strong: ({ children }) => (
          <strong className={cx('font-semibold', inverted ? '' : 'text-ink')}>{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        del: ({ children }) => <del className="opacity-60">{children}</del>,

        /** Headings inside a chat bubble are a change of voice, not a document
         *  outline — so they all render the same, one notch above the body. */
        h1: Heading,
        h2: Heading,
        h3: Heading,
        h4: Heading,
        h5: Heading,
        h6: Heading,

        ul: ({ children }) => (
          <ul className="my-1.5 flex list-outside list-disc flex-col gap-1 pl-4 first:mt-0 last:mb-0">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-1.5 flex list-outside list-decimal flex-col gap-1 pl-4 first:mt-0 last:mb-0">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-[1.5] marker:text-muted">{children}</li>,

        /** The reason `remark-gfm` is here. Scrolls rather than squeezes: a
         *  five-column comparison in a 560px panel has to go somewhere, and
         *  wrapping every cell to three lines loses the shape that made it a
         *  table. */
        table: ({ children }) => (
          <div className="-mx-1 my-2 overflow-x-auto first:mt-0 last:mb-0">
            <table className="w-full border-collapse text-[12px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead>{children}</thead>,
        th: ({ children }) => (
          <th className="border-b border-line px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="num border-b border-line px-2 py-1.5 align-top last:text-right">
            {children}
          </td>
        ),

        code: ({ children, className }) => {
          /** A fenced block carries a language class; an inline span does not.
           *  The two want different shapes and this is the only way the
           *  renderer distinguishes them. */
          const fenced = typeof className === 'string' && className.includes('language-')
          if (fenced) return <code className="block font-mono text-[11.5px]">{children}</code>
          return (
            <code className="rounded-[4px] bg-sunken px-1 py-0.5 font-mono text-[11.5px]">
              {children}
            </code>
          )
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-[8px] bg-sunken p-2.5 first:mt-0 last:mb-0">
            {children}
          </pre>
        ),

        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-line2 pl-2.5 text-muted first:mt-0 last:mb-0">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-2.5 border-0 border-t border-line" />,

        /** Anything the model links to is outside this app. Opened in a new
         *  tab with the opener severed, because the destination came out of a
         *  model and nothing downstream has checked it. */
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-line2 underline-offset-2"
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function Heading({ children }: { children?: ReactNode }) {
  return (
    <span className="mt-2.5 mb-1 block text-[13px] font-semibold first:mt-0">{children}</span>
  )
}
