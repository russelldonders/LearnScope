import { normaliseMediaUrl, normalisePageDocument } from '../lib/pageBuilder'

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
        if (block.type === 'image') return <PageMedia key={block.id} block={block} />
        if (block.type === 'video') return <PageMedia key={block.id} block={block} />
        return <RichText key={block.id} html={block.content} className="page-paragraph" />
      })}
    </article>
  )
}

export function PageMedia({ block }) {
  const url = normaliseMediaUrl(block.url, block.type)
  if (!url) return null
  const isEmbed = /^(https:\/\/www\.youtube\.com\/embed\/|https:\/\/player\.vimeo\.com\/video\/)/.test(url)
  return (
    <figure className="page-media">
      {block.type === 'image' ? (
        <img src={url} alt={block.alt} loading="lazy" />
      ) : isEmbed ? (
        <iframe src={url} title={block.alt || block.caption || 'Embedded video'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      ) : (
        <video src={url} controls preload="metadata" aria-label={block.alt || block.caption || 'Video'} />
      )}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  )
}
