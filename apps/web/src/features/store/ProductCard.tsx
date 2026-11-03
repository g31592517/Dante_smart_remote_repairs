import { Link } from 'react-router';
import { ImageOff } from 'lucide-react';
import type { Product } from '../../lib/types';
import { mediaUrl } from '../../lib/api';
import { useMoney } from '../../lib/settings';
import { Badge } from '../../components/ui';

export function StockBadge({ stock }: { stock: Product['stock'] }) {
  if (stock.status === 'OUT_OF_STOCK') return <Badge color="red">Out of stock</Badge>;
  if (stock.status === 'LOW_STOCK') return <Badge color="amber">Only {stock.available} left</Badge>;
  return <Badge color="green">In stock</Badge>;
}

export function ProductImage({ product, className = '' }: { product: Product; className?: string }) {
  const img = product.images[0];
  return img ? (
    <img src={mediaUrl(img.url)} alt={img.alt} loading="lazy" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-ink-100 to-white text-ink-600 ${className}`}>
      <ImageOff className="size-6 opacity-50" aria-hidden />
      <span className="px-3 text-center font-display text-xs font-semibold tracking-wide uppercase opacity-70">{product.brand ?? product.categoryName}</span>
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const money = useMoney();
  return (
    <Link to={`/shop/${product.slug}`} className="group card flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
      <div className="aspect-[4/3] overflow-hidden bg-ink-50"><ProductImage product={product} className="transition-transform group-hover:scale-[1.02]" /></div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap gap-1.5">
          {product.condition !== 'NEW' && <Badge color="violet">{product.condition === 'REFURBISHED' ? 'Refurbished' : 'Used'}</Badge>}
          <StockBadge stock={product.stock} />
        </div>
        <h3 className="line-clamp-2 font-semibold text-ink-900">{product.name}</h3>
        <p className="text-xs text-slate-500">{product.categoryName} · SKU {product.sku}</p>
        <p className="mt-auto pt-1 font-display text-lg font-semibold text-ink-900">{money(product.priceMinor)}</p>
      </div>
    </Link>
  );
}
