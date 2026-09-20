/** The assistant's mark: a gradient disc with a hole punched in it.
 *
 *  Its own file, and that is the point — the header shows it on a button that
 *  is always there, while the panel it opens is loaded on demand. Leaving it
 *  in the panel's module would drag the whole chat, its Markdown renderer and
 *  its charts into the shell for the sake of one 18px circle.
 *
 *  Not an icon from the set: every icon in this app is a line drawing in the
 *  ink colour, and the assistant is the one thing that is not part of the
 *  branch's own vocabulary. */
export function Spark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full"
      style={{ width: size, height: size, background: 'var(--ai-grad)' }}
    >
      <span
        className="rounded-full bg-surface"
        style={{ width: Math.round(size * 0.3), height: Math.round(size * 0.3) }}
      />
    </span>
  )
}
