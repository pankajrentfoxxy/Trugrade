import { Carousel } from '@trugrade/ui';
import { getSearch, type SearchResult } from '../../../lib/api';
import { SearchResultCard } from '../../search/SearchResultCard';

/**
 * "You may also like" — other machines for sale, under the questions.
 *
 * **Not this model.** Every row for the model on the page is left out —
 * every grade and every configuration of it — because the switches above
 * already offer those, and a rail that repeated the machine the buyer is
 * looking at would be padding, not a suggestion.
 *
 * **Real stock, real prices, nothing invented.** The rows come from the same
 * search index the search page renders, so every card is a SKU with sealed
 * units behind it and its price is the one its own page will show. One card
 * per SKU: the index carries a row per grade, and the cheapest grade stands
 * for the machine here since a buyer switches grade on the page it opens.
 * Ten at most, in the index's own order (relevance to nothing, so it falls
 * back to the default ranking). The index is asked for a page and filtered
 * client-side, so a model with many grades and configurations cannot eat
 * the whole rail.
 *
 * **Absent rather than empty.** When the index returns nothing else, or does
 * not answer, the section is not drawn at all. A heading over a blank rail
 * would be a promise the page then breaks.
 */
const LIMIT = 10;

export async function RelatedProducts({
  brandName,
  modelName,
}: {
  brandName: string;
  modelName: string;
}): Promise<React.JSX.Element | null> {
  const page = await getSearch('per=48');
  if (!page) return null;

  const others = page.results.filter((r) => !(r.brand === brandName && r.model === modelName));

  // Cheapest grade per SKU, in first-seen order so the index's ranking holds.
  const bySku = new Map<string, SearchResult>();
  for (const r of others) {
    const seen = bySku.get(r.skuId);
    if (!seen || r.fromPrice < seen.fromPrice) bySku.set(r.skuId, r);
  }
  const picks = [...bySku.values()].slice(0, LIMIT);
  if (picks.length === 0) return null;

  return (
    <section className="rel" aria-labelledby="rel-h" data-testid="related">
      <h2 className="sec-t" id="rel-h">
        You may also like
      </h2>
      <Carousel label="Other laptops" className="rel-rail" trackClassName="rel-track">
        {picks.map((r) => (
          <SearchResultCard key={`${r.skuId}-${r.grade}`} r={r} />
        ))}
      </Carousel>
    </section>
  );
}
