import { normalisePageDocument } from '../lib/pageBuilder'

function RichText({ html, className = '' }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function PageContent({ document, compact = false }) {
  const page = normalisePageDocument(document)
  return (
    <article className={`page-content mx-auto w-full ${compact ? 'max-w-3xl' : 'max-w-[70ch]'}`}>
      {page.blocks.map((block) => {
        if (block.type === 'heading') {
          const Tag = block.level === 2 ? 'h2' : 'h1'
          return <RichText key={block.id} html={block.content} className={Tag === 'h1' ? 'page-heading' : 'page-subheading'} />
        }
        if (block.type === 'callout') return <RichText key={block.id} html={block.content} className="page-callout" />
        if (block.type === 'divider') return <hr key={block.id} className="page-divider" />
        if (block.type === 'columns') {
          return (
            <div key={block.id} className="page-columns">
              <RichText html={block.content} />
              <RichText html={block.secondaryContent} />
            </div>
          )
        }
        return <RichText key={block.id} html={block.content} className="page-paragraph" />
      })}
    </article>
  )
}
