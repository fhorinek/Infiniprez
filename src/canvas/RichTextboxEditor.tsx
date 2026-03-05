import { useCallback, useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAlignCenter,
  faAlignLeft,
  faAlignRight,
  faBold,
  faCheck,
  faEraser,
  faHighlighter,
  faItalic,
  faListOl,
  faListUl,
  faMinus,
  faPlus,
  faStrikethrough,
  faUnderline,
} from '@fortawesome/free-solid-svg-icons'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Extension, type ChainedCommands } from '@tiptap/core'

const FONT_FAMILIES = [
  'Space Grotesk',
  'IBM Plex Sans',
  'Inter',
  'Segoe UI',
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Courier New',
  'Lucida Console',
  'Roboto',
  'Open Sans',
  'Lato',
  'Poppins',
  'Nunito',
  'Merriweather',
  'Playfair Display',
  'Fira Sans',
  'Source Sans 3',
  'Ubuntu',
  'JetBrains Mono',
]
const FONT_SIZE_POINTS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]
const MIN_FONT_SIZE_PT = 6
const MAX_FONT_SIZE_PT = 240
const PX_PER_PT = 96 / 72

function pxToPt(px: number): number {
  return px / PX_PER_PT
}

function ptToPx(pt: number): number {
  return pt * PX_PER_PT
}

function clampFontSizePt(pt: number): number {
  return Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, Number(pt.toFixed(1))))
}

function parseFontSizeToPt(value: string | undefined): number {
  if (!value) {
    return pxToPt(28)
  }
  const numeric = Number(value.replace('px', '').replace('pt', '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return pxToPt(28)
  }
  if (value.endsWith('pt')) {
    return numeric
  }
  return pxToPt(numeric)
}

function formatPt(pt: number): string {
  return Number.isInteger(pt) ? String(pt) : pt.toFixed(1)
}

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: { fontSize?: string | null }) => {
              if (!attributes.fontSize) {
                return {}
              }
              return { style: `font-size: ${attributes.fontSize}` }
            },
          },
        },
      },
    ]
  },
})

const TabKeymap = Extension.create({
  name: 'tabKeymap',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('listItem')) {
          const didIndent = this.editor.commands.sinkListItem('listItem')
          if (didIndent) {
            return true
          }
        }
        return this.editor.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('listItem')) {
          const didOutdent = this.editor.commands.liftListItem('listItem')
          if (didOutdent) {
            return true
          }
        }
        return true
      },
    }
  },
})

interface RichTextboxEditorProps {
  editorKey: string
  html: string
  fontFamily: string
  contentScale: number
  onContentChange: (next: { html: string; plainText: string; contentHeight: number }) => void
  onEditorBlur: (relatedTarget: EventTarget | null) => void
  onEscape: () => void
  onCommit: () => void
}

export function RichTextboxEditor({
  editorKey,
  html,
  fontFamily,
  contentScale,
  onContentChange,
  onEditorBlur,
  onEscape,
  onCommit,
}: RichTextboxEditorProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const lastRangeSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const initializedEditorKeyRef = useRef<string | null>(null)
  const onContentChangeRef = useRef(onContentChange)
  const [fontSizePtValue, setFontSizePtValue] = useState(clampFontSizePt(pxToPt(28)))
  const [fontSizePtInput, setFontSizePtInput] = useState(formatPt(clampFontSizePt(pxToPt(28))))
  const [fontFamilyValue, setFontFamilyValue] = useState(fontFamily)
  const [textColor, setTextColor] = useState('#f0f3fc')
  const [highlightColor, setHighlightColor] = useState('#fff59d')

  useEffect(() => {
    onContentChangeRef.current = onContentChange
  }, [onContentChange])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Underline,
        TextStyle,
        FontSize,
        TabKeymap,
        TextAlign.configure({
          types: ['paragraph', 'heading'],
        }),
        Color,
        FontFamily,
        Highlight.configure({ multicolor: true }),
      ],
      content: html,
      editorProps: {
        attributes: {
          class: 'textbox-rich-content',
          style: `font-family: ${fontFamily};`,
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onEscape()
            return true
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            onCommit()
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        const nextHtml = currentEditor.getHTML()
        const plainText = currentEditor.getText({ blockSeparator: '\n' })
        const contentHeight = (currentEditor.view.dom as HTMLElement).scrollHeight
        onContentChangeRef.current({
          html: nextHtml,
          plainText,
          contentHeight,
        })
      },
    },
    [editorKey]
  )

  const readToolbarState = useCallback(() => {
    if (!editor) {
      return
    }
    const selection = editor.state.selection
    const nextSelection = { from: selection.from, to: selection.to }
    lastSelectionRef.current = nextSelection
    if (nextSelection.to > nextSelection.from) {
      lastRangeSelectionRef.current = nextSelection
    }

    const textStyle = editor.getAttributes('textStyle') as {
      fontSize?: string
      fontFamily?: string
      color?: string
    }
    const highlight = editor.getAttributes('highlight') as {
      color?: string
    }

    const fontSizePt = clampFontSizePt(parseFontSizeToPt(textStyle.fontSize))
    setFontSizePtValue(fontSizePt)
    setFontSizePtInput(formatPt(fontSizePt))
    setFontFamilyValue(textStyle.fontFamily || fontFamily)
    setTextColor(textStyle.color || '#f0f3fc')
    setHighlightColor(highlight.color || '#fff59d')
  }, [editor, fontFamily])

  useEffect(() => {
    if (!editor) {
      return
    }

    readToolbarState()
    const onAnyUpdate = () => {
      readToolbarState()
    }
    editor.on('selectionUpdate', onAnyUpdate)
    editor.on('transaction', onAnyUpdate)
    return () => {
      editor.off('selectionUpdate', onAnyUpdate)
      editor.off('transaction', onAnyUpdate)
    }
  }, [editor, readToolbarState])

  useEffect(() => {
    if (!editor) {
      return
    }
    const dom = editor.view.dom as HTMLElement
    dom.className = 'textbox-rich-content'
    dom.style.fontFamily = fontFamily
  }, [editor, fontFamily])

  useEffect(() => {
    if (!editor) {
      return
    }
    if (initializedEditorKeyRef.current === editorKey) {
      return
    }
    initializedEditorKeyRef.current = editorKey
    lastSelectionRef.current = null
    lastRangeSelectionRef.current = null
    editor.commands.focus('end')
    const contentHeight = (editor.view.dom as HTMLElement).scrollHeight
    onContentChangeRef.current({
      html: editor.getHTML(),
      plainText: editor.getText({ blockSeparator: '\n' }),
      contentHeight,
    })
  }, [editor, editorKey])

  const runToolbarCommand = useCallback(
    (build: (chain: ChainedCommands) => ChainedCommands) => {
      if (!editor) {
        return
      }
      let chain = editor.chain().focus()
      const currentSelection = editor.state.selection
      const liveSelection = {
        from: currentSelection.from,
        to: currentSelection.to,
      }
      if (liveSelection.to > liveSelection.from) {
        lastRangeSelectionRef.current = liveSelection
        chain = chain.setTextSelection(liveSelection)
      } else {
        const savedSelection = lastRangeSelectionRef.current ?? lastSelectionRef.current
        if (savedSelection && savedSelection.to > savedSelection.from) {
          chain = chain.setTextSelection(savedSelection)
        }
      }
      build(chain).run()
    },
    [editor]
  )

  const applyFontSizePt = useCallback(
    (nextPt: number) => {
      const clampedPt = clampFontSizePt(nextPt)
      const clampedPx = ptToPx(clampedPt)
      setFontSizePtValue(clampedPt)
      setFontSizePtInput(formatPt(clampedPt))
      runToolbarCommand((chain) => chain.setMark('textStyle', { fontSize: `${clampedPx}px` }))
    },
    [runToolbarCommand]
  )

  const applyFontSizeInput = useCallback(() => {
    const parsed = Number(fontSizePtInput)
    if (Number.isFinite(parsed) && parsed > 0) {
      applyFontSizePt(parsed)
      return
    }
    setFontSizePtInput(formatPt(fontSizePtValue))
  }, [applyFontSizePt, fontSizePtInput, fontSizePtValue])

  const toggleBulletList = useCallback(() => {
    if (!editor) {
      return
    }
    runToolbarCommand((chain) => {
      if (editor.isActive('orderedList')) {
        return chain.toggleOrderedList().toggleBulletList()
      }
      return chain.toggleBulletList()
    })
  }, [editor, runToolbarCommand])

  const toggleOrderedList = useCallback(() => {
    if (!editor) {
      return
    }
    runToolbarCommand((chain) => {
      if (editor.isActive('bulletList')) {
        return chain.toggleBulletList().toggleOrderedList()
      }
      return chain.toggleOrderedList()
    })
  }, [editor, runToolbarCommand])

  return (
    <div
      className="textbox-editor-shell"
      ref={shellRef}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (nextTarget && shellRef.current?.contains(nextTarget)) {
          return
        }
        onEditorBlur(event.relatedTarget)
      }}
    >
      <div
        className="textbox-native-toolbar"
        role="toolbar"
        aria-label="Text formatting"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('button')) {
            event.preventDefault()
          }
        }}
      >
        <div className="textbox-toolbar-row">
          <label className="textbox-toolbar-field textbox-toolbar-font-family">
            <span>Font</span>
            <select
              value={fontFamilyValue}
              style={{ fontFamily: fontFamilyValue }}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = event.target.value
                setFontFamilyValue(value)
                runToolbarCommand((chain) => chain.setFontFamily(value))
              }}
            >
              {FONT_FAMILIES.map((entry) => (
                <option key={entry} value={entry} style={{ fontFamily: entry }}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="textbox-toolbar-field textbox-toolbar-font-size">
            <span>Size (pt)</span>
            <div className="textbox-toolbar-size-control">
              <input
                type="number"
                min={MIN_FONT_SIZE_PT}
                max={MAX_FONT_SIZE_PT}
                step={0.5}
                list="textbox-font-size-pt-options"
                value={fontSizePtInput}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  setFontSizePtInput(event.target.value)
                  const parsed = Number(event.target.value)
                  if (Number.isFinite(parsed) && parsed > 0) {
                    applyFontSizePt(parsed)
                  }
                }}
                onBlur={applyFontSizeInput}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyFontSizeInput()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setFontSizePtInput(formatPt(fontSizePtValue))
                  }
                }}
                aria-label="Font size in points"
                title="Font size in points"
              />
              <button
                type="button"
                className="textbox-toolbar-icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFontSizePt(fontSizePtValue + 1)}
                aria-label="Increase font size"
                title="Increase font size"
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
              <button
                type="button"
                className="textbox-toolbar-icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFontSizePt(fontSizePtValue - 1)}
                aria-label="Decrease font size"
                title="Decrease font size"
              >
                <FontAwesomeIcon icon={faMinus} />
              </button>
            </div>
          </label>
          <datalist id="textbox-font-size-pt-options">
            {FONT_SIZE_POINTS.map((sizePt) => (
              <option key={sizePt} value={sizePt} />
            ))}
          </datalist>

          <div className="textbox-toolbar-divider" />

          <label className="textbox-toolbar-field">
            <span>Color</span>
            <input
              type="color"
              value={textColor}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = event.target.value
                setTextColor(value)
                runToolbarCommand((chain) => chain.setColor(value))
              }}
              aria-label="Text color"
              title="Text color"
            />
          </label>

          <div className="textbox-toolbar-divider" />

          <label className="textbox-toolbar-field">
            <span>Highlight</span>
            <div className="textbox-toolbar-highlight-control">
              <input
                type="color"
                value={highlightColor}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const value = event.target.value
                  setHighlightColor(value)
                  runToolbarCommand((chain) => chain.setHighlight({ color: value }))
                }}
                aria-label="Highlight color"
                title="Highlight color"
              />
              <button
                type="button"
                className={`textbox-toolbar-icon-btn ${editor?.isActive('highlight') ? 'active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.setHighlight({ color: highlightColor }))}
                aria-label="Apply highlight"
                title="Apply highlight"
              >
                <FontAwesomeIcon icon={faHighlighter} />
              </button>
              <button
                type="button"
                className="textbox-toolbar-icon-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarCommand((chain) => chain.unsetHighlight())}
                aria-label="Clear highlight"
                title="Clear highlight"
              >
                <FontAwesomeIcon icon={faEraser} />
              </button>
            </div>
          </label>

        </div>

        <div className="textbox-toolbar-row">
          <button
            type="button"
            className={`textbox-toolbar-icon-btn ${editor?.isActive('bold') ? 'active' : ''}`}
            aria-label="Bold"
            title="Bold"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbarCommand((chain) => chain.toggleBold())}
          >
            <FontAwesomeIcon icon={faBold} />
          </button>
          <button
            type="button"
            className={`textbox-toolbar-icon-btn ${editor?.isActive('italic') ? 'active' : ''}`}
            aria-label="Italic"
            title="Italic"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbarCommand((chain) => chain.toggleItalic())}
          >
            <FontAwesomeIcon icon={faItalic} />
          </button>
          <button
            type="button"
            className={`textbox-toolbar-icon-btn ${editor?.isActive('underline') ? 'active' : ''}`}
            aria-label="Underline"
            title="Underline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbarCommand((chain) => chain.toggleUnderline())}
          >
            <FontAwesomeIcon icon={faUnderline} />
          </button>
          <button
            type="button"
            className={`textbox-toolbar-icon-btn ${editor?.isActive('strike') ? 'active' : ''}`}
            aria-label="Strikethrough"
            title="Strikethrough"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbarCommand((chain) => chain.toggleStrike())}
          >
            <FontAwesomeIcon icon={faStrikethrough} />
          </button>

          <div className="textbox-toolbar-divider" />

          <div className="textbox-toolbar-list-toggle" role="group" aria-label="List type">
            <button
              type="button"
              className={`textbox-toolbar-icon-btn ${editor?.isActive('bulletList') ? 'active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleBulletList}
              aria-label="Bullet list"
              title="Bullet list"
            >
              <FontAwesomeIcon icon={faListUl} />
            </button>
            <button
              type="button"
              className={`textbox-toolbar-icon-btn ${editor?.isActive('orderedList') ? 'active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleOrderedList}
              aria-label="Numbered list"
              title="Numbered list"
            >
              <FontAwesomeIcon icon={faListOl} />
            </button>
          </div>

          <div className="textbox-toolbar-divider" />

          <button
            type="button"
            className={`textbox-toolbar-icon-btn ${
              editor?.isActive({ textAlign: 'left' }) ||
              (!editor?.isActive({ textAlign: 'center' }) && !editor?.isActive({ textAlign: 'right' }))
                ? 'active'
                : ''
            }`}
            aria-label="Align left"
            title="Align left"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbarCommand((chain) => chain.setTextAlign('left'))}
          >
            <FontAwesomeIcon icon={faAlignLeft} />
          </button>
          <button
            type="button"
            className={`textbox-toolbar-icon-btn ${editor?.isActive({ textAlign: 'center' }) ? 'active' : ''}`}
            aria-label="Align center"
            title="Align center"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbarCommand((chain) => chain.setTextAlign('center'))}
          >
            <FontAwesomeIcon icon={faAlignCenter} />
          </button>
          <button
            type="button"
            className={`textbox-toolbar-icon-btn ${editor?.isActive({ textAlign: 'right' }) ? 'active' : ''}`}
            aria-label="Align right"
            title="Align right"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runToolbarCommand((chain) => chain.setTextAlign('right'))}
          >
            <FontAwesomeIcon icon={faAlignRight} />
          </button>

          <div className="textbox-toolbar-divider textbox-toolbar-grow" />

          <button
            type="button"
            className="textbox-toolbar-icon-btn textbox-toolbar-done-btn"
            aria-label="Done editing"
            title="Done editing"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCommit}
          >
            <FontAwesomeIcon icon={faCheck} />
            <span>Done</span>
          </button>
        </div>
      </div>

      <div
        className="textbox-rich-editor-surface"
        style={{
          transform: `scale(${contentScale})`,
          transformOrigin: 'top left',
          width: `${100 / contentScale}%`,
          height: `${100 / contentScale}%`,
        }}
      >
        <EditorContent editor={editor} className="textbox-rich-editor" />
      </div>
    </div>
  )
}
