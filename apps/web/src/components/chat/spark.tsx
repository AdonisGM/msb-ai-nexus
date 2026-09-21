import { BotMessageSquare } from 'lucide-react'

/** The assistant's mark: Lucide's bot-in-a-speech-bubble, drawn in the
 *  surface colour on the assistant's gradient.
 *
 *  Its own file, and that is the point — the header shows it on a button that
 *  is always there, while the panel it opens is loaded on demand. Leaving it
 *  in the panel's module would drag the whole chat, its Markdown renderer and
 *  its charts into the shell for the sake of one 18px icon.
 *
 *  The glyph is from the same set as every other icon here; the gradient
 *  behind it is not. Every other icon is a line drawing in the ink colour, and
 *  the assistant is the one thing that is not part of the branch's own
 *  vocabulary — the disc is what keeps it from reading as one more button. */
export function Spark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full"
      style={{ width: size, height: size, background: 'var(--ai-grad)' }}
    >
      <BotMessageSquare
        size={Math.round(size * 0.6)}
        /** Thicker than the set's default at the smallest size, where a
         *  1.5px stroke on an 11px glyph turns to grey fuzz. */
        strokeWidth={size < 22 ? 2.4 : 2}
        className="text-surface"
        aria-hidden
      />
    </span>
  )
}
