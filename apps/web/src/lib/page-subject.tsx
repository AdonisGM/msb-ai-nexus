import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** The record the current screen is about, for the assistant to offer.
 *
 *  A detail screen says what it is showing; the assistant, which lives in the
 *  shell and knows nothing about routes, reads it. Only a reference and a
 *  label for the chip travel — the server reads the record itself, through
 *  the person's own scope, when a message is sent with it attached. */
export type PageSubject = {
  kind: 'customer' | 'opportunity'
  id: string
  /** For the chip only. The model is given the name the server reads. */
  label: string
}

type Store = {
  subject: PageSubject | null
  set: (subject: PageSubject | null) => void
}

const Context = createContext<Store>({ subject: null, set: () => {} })

export function PageSubjectProvider({ children }: { children: ReactNode }) {
  const [subject, set] = useState<PageSubject | null>(null)
  return <Context.Provider value={{ subject, set }}>{children}</Context.Provider>
}

/** Declares what this screen is about, for as long as it is on screen.
 *
 *  Pass null while the record is still loading. Cleared on the way out, so
 *  leaving a customer's page for the dashboard does not leave that customer
 *  attached to the next question. */
export function usePageSubject(subject: PageSubject | null) {
  const { set } = useContext(Context)
  const key = subject ? `${subject.kind}:${subject.id}:${subject.label}` : ''

  useEffect(() => {
    set(subject)
    return () => set(null)
    /** Keyed on the record, not the object: a screen builds a new object on
     *  every render, and clearing and re-setting on each one would flicker
     *  the chip. */
  }, [key, set])
}

export function useCurrentSubject(): PageSubject | null {
  return useContext(Context).subject
}
