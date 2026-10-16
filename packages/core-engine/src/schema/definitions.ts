/**
 * Declarative field definitions for the visual JSON-LD builder. Field `key`s are JSON-LD property
 * paths (dot-separated), so the form, the builder and the validator share one vocabulary and
 * validation errors map straight back onto form fields.
 */

export type SchemaType = "LocalBusiness" | "Product" | "FAQPage" | "Article" | "SoftwareApplication"

export type FieldType =
  | "text"
  | "textarea"
  | "url"
  | "email"
  | "tel"
  | "number"
  | "date"
  | "time"
  | "select"
  | "multiselect"
  | "urlList"
  | "list"

export interface FieldOption {
  value: string
  label: string
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  recommended?: boolean
  help?: string
  placeholder?: string
  options?: FieldOption[]
  /** For select fields whose values are schema.org enumeration members ("InStock" → https://schema.org/InStock). */
  enumUrl?: boolean
  /** Sub-fields for `list` items. */
  fields?: FieldDef[]
  itemLabel?: string
  /** @type given to each list item. */
  itemType?: string
  maxLength?: number
  min?: number
  max?: number
  step?: number
  defaultValue?: unknown
}

export interface SchemaTypeDef {
  type: SchemaType
  label: string
  description: string
  /** Google rich result this type can unlock. */
  richResult: string
  docsUrl: string
  fields: FieldDef[]
  example: SchemaFormData
}

export type SchemaFormValue = string | number | string[] | SchemaFormData[] | undefined | null
export interface SchemaFormData {
  [key: string]: SchemaFormValue
}

const opts = (...values: string[]): FieldOption[] =>
  values.map((v) => ({ value: v, label: v.replace(/([a-z])([A-Z])/g, "$1 $2") }))

const DAYS = opts("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

const RATING_FIELDS: FieldDef[] = [
  { key: "aggregateRating.ratingValue", label: "Average rating", type: "number", min: 1, max: 5, step: 0.1, recommended: true, placeholder: "4.8" },
  { key: "aggregateRating.reviewCount", label: "Review count", type: "number", min: 0, step: 1, placeholder: "127" },
  { key: "aggregateRating.bestRating", label: "Best possible rating", type: "number", min: 1, step: 1, placeholder: "5" },
]

const OFFER_FIELDS: FieldDef[] = [
  { key: "offers.price", label: "Price", type: "number", min: 0, step: 0.01, placeholder: "49.00", help: "Number only, no currency symbol." },
  { key: "offers.priceCurrency", label: "Currency (ISO 4217)", type: "text", placeholder: "USD", maxLength: 3 },
]

export const SCHEMA_DEFINITIONS: Record<SchemaType, SchemaTypeDef> = {
  LocalBusiness: {
    type: "LocalBusiness",
    label: "Local Business",
    description: "Shops, restaurants, studios and service areas — powers the knowledge panel and map pack details.",
    richResult: "Local business knowledge panel",
    docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/local-business",
    fields: [
      {
        key: "@type",
        label: "Business type",
        type: "select",
        defaultValue: "LocalBusiness",
        options: opts(
          "LocalBusiness", "Restaurant", "CafeOrCoffeeShop", "Bakery", "BarOrPub", "Store", "ClothingStore",
          "ProfessionalService", "LegalService", "AccountingService", "FinancialService", "RealEstateAgent",
          "MedicalBusiness", "Dentist", "Physician", "BeautySalon", "HairSalon", "DaySpa", "HealthClub",
          "AutoRepair", "HomeAndConstructionBusiness", "Plumber", "Electrician", "Hotel", "TravelAgency",
        ),
      },
      { key: "name", label: "Business name", type: "text", required: true, placeholder: "Blue Door Coffee" },
      { key: "description", label: "Description", type: "textarea", maxLength: 500 },
      { key: "url", label: "Website", type: "url", recommended: true, placeholder: "https://example.com" },
      { key: "image", label: "Photo / logo URL", type: "url", recommended: true },
      { key: "telephone", label: "Phone", type: "tel", recommended: true, placeholder: "+1-415-555-0100" },
      { key: "email", label: "Email", type: "email" },
      { key: "priceRange", label: "Price range", type: "text", recommended: true, placeholder: "$$", maxLength: 100 },
      { key: "address.streetAddress", label: "Street address", type: "text", required: true },
      { key: "address.addressLocality", label: "City", type: "text", required: true },
      { key: "address.addressRegion", label: "State / region", type: "text", recommended: true },
      { key: "address.postalCode", label: "Postal code", type: "text", recommended: true },
      { key: "address.addressCountry", label: "Country (ISO code)", type: "text", recommended: true, placeholder: "US", maxLength: 2 },
      { key: "geo.latitude", label: "Latitude", type: "number", step: 0.000001, min: -90, max: 90, recommended: true },
      { key: "geo.longitude", label: "Longitude", type: "number", step: 0.000001, min: -180, max: 180, recommended: true },
      {
        key: "openingHoursSpecification",
        label: "Opening hours",
        type: "list",
        recommended: true,
        itemLabel: "Hours",
        itemType: "OpeningHoursSpecification",
        fields: [
          { key: "dayOfWeek", label: "Days", type: "multiselect", options: DAYS, required: true },
          { key: "opens", label: "Opens", type: "time", required: true, placeholder: "09:00" },
          { key: "closes", label: "Closes", type: "time", required: true, placeholder: "17:00" },
        ],
      },
      { key: "servesCuisine", label: "Cuisine (restaurants)", type: "text" },
      { key: "menu", label: "Menu URL (restaurants)", type: "url" },
      { key: "sameAs", label: "Social profiles", type: "urlList", help: "One URL per line (Instagram, Yelp, Facebook…)" },
      ...RATING_FIELDS,
    ],
    example: {
      "@type": "CafeOrCoffeeShop",
      name: "Blue Door Coffee",
      description: "Specialty coffee roasters serving single-origin espresso in the Mission.",
      url: "https://bluedoor.coffee",
      image: "https://bluedoor.coffee/storefront.jpg",
      telephone: "+1-415-555-0100",
      priceRange: "$$",
      "address.streetAddress": "123 Valencia St",
      "address.addressLocality": "San Francisco",
      "address.addressRegion": "CA",
      "address.postalCode": "94103",
      "address.addressCountry": "US",
      "geo.latitude": 37.76493,
      "geo.longitude": -122.42189,
      openingHoursSpecification: [
        { dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "07:00", closes: "18:00" },
        { dayOfWeek: ["Saturday", "Sunday"], opens: "08:00", closes: "16:00" },
      ],
      sameAs: ["https://www.instagram.com/bluedoorcoffee"],
      "aggregateRating.ratingValue": 4.8,
      "aggregateRating.reviewCount": 213,
    },
  },

  Product: {
    type: "Product",
    label: "Product",
    description: "Price, availability and star ratings in search results and Google Shopping surfaces.",
    richResult: "Product snippet / merchant listing",
    docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/product",
    fields: [
      { key: "name", label: "Product name", type: "text", required: true },
      { key: "image", label: "Image URL", type: "url", recommended: true },
      { key: "description", label: "Description", type: "textarea", recommended: true, maxLength: 5000 },
      { key: "brand.name", label: "Brand", type: "text", recommended: true },
      { key: "sku", label: "SKU", type: "text" },
      { key: "gtin", label: "GTIN / EAN / UPC", type: "text", help: "8, 12, 13 or 14 digits." },
      { key: "mpn", label: "MPN", type: "text" },
      { ...OFFER_FIELDS[0]!, recommended: true },
      { ...OFFER_FIELDS[1]!, recommended: true },
      {
        key: "offers.availability",
        label: "Availability",
        type: "select",
        enumUrl: true,
        defaultValue: "InStock",
        options: opts("InStock", "OutOfStock", "PreOrder", "BackOrder", "LimitedAvailability", "OnlineOnly", "SoldOut", "Discontinued"),
      },
      {
        key: "offers.itemCondition",
        label: "Condition",
        type: "select",
        enumUrl: true,
        options: opts("NewCondition", "UsedCondition", "RefurbishedCondition", "DamagedCondition"),
      },
      { key: "offers.url", label: "Buy URL", type: "url" },
      { key: "offers.priceValidUntil", label: "Price valid until", type: "date" },
      ...RATING_FIELDS,
      {
        key: "review",
        label: "Reviews",
        type: "list",
        itemLabel: "Review",
        itemType: "Review",
        fields: [
          { key: "author.name", label: "Author", type: "text", required: true },
          { key: "reviewRating.ratingValue", label: "Rating", type: "number", min: 1, max: 5, step: 0.5, required: true },
          { key: "reviewBody", label: "Review", type: "textarea" },
          { key: "datePublished", label: "Date", type: "date" },
        ],
      },
    ],
    example: {
      name: "Aero Pour-Over Kettle",
      image: "https://shop.example.com/images/aero-kettle.jpg",
      description: "Gooseneck kettle with 1°C temperature control and a 60-minute hold mode.",
      "brand.name": "Blue Door",
      sku: "BD-KETTLE-01",
      "offers.price": 89,
      "offers.priceCurrency": "USD",
      "offers.availability": "InStock",
      "offers.itemCondition": "NewCondition",
      "offers.url": "https://shop.example.com/kettle",
      "aggregateRating.ratingValue": 4.7,
      "aggregateRating.reviewCount": 58,
    },
  },

  FAQPage: {
    type: "FAQPage",
    label: "FAQ Page",
    description: "Question & answer pairs (government and health sites get FAQ rich results; all sites benefit in AI overviews).",
    richResult: "FAQ rich result",
    docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/faqpage",
    fields: [
      {
        key: "mainEntity",
        label: "Questions",
        type: "list",
        required: true,
        itemLabel: "Question",
        itemType: "Question",
        fields: [
          { key: "name", label: "Question", type: "text", required: true },
          { key: "acceptedAnswer.text", label: "Answer", type: "textarea", required: true, help: "Basic HTML allowed: <p>, <a>, <ul>, <li>, <b>, <i>." },
        ],
      },
    ],
    example: {
      mainEntity: [
        { name: "Do you ship internationally?", "acceptedAnswer.text": "Yes — we ship to 40+ countries. Duties are calculated at checkout." },
        { name: "What is your return policy?", "acceptedAnswer.text": "Unused items can be returned within 30 days for a full refund." },
      ],
    },
  },

  Article: {
    type: "Article",
    label: "Article / Blog post",
    description: "Headline, images, author and dates for article rich results and Top Stories.",
    richResult: "Article rich result",
    docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/article",
    fields: [
      { key: "@type", label: "Article type", type: "select", defaultValue: "BlogPosting", options: opts("Article", "BlogPosting", "NewsArticle", "TechArticle") },
      { key: "headline", label: "Headline", type: "text", required: true, maxLength: 110 },
      { key: "description", label: "Summary", type: "textarea" },
      { key: "image", label: "Image URL", type: "url", recommended: true, help: "Min 1200px wide; 16:9, 4:3 and 1:1 variants recommended." },
      { key: "datePublished", label: "Published", type: "date", recommended: true },
      { key: "dateModified", label: "Last modified", type: "date", recommended: true },
      {
        key: "author",
        label: "Authors",
        type: "list",
        recommended: true,
        itemLabel: "Author",
        itemType: "Person",
        fields: [
          { key: "@type", label: "Type", type: "select", options: opts("Person", "Organization"), defaultValue: "Person" },
          { key: "name", label: "Name", type: "text", required: true },
          { key: "url", label: "Profile URL", type: "url" },
        ],
      },
      { key: "publisher.name", label: "Publisher", type: "text" },
      { key: "publisher.logo.url", label: "Publisher logo URL", type: "url" },
      { key: "mainEntityOfPage", label: "Canonical URL", type: "url" },
    ],
    example: {
      "@type": "BlogPosting",
      headline: "How to Brew Better Pour-Over Coffee at Home",
      description: "A step-by-step guide to grind size, water temperature and timing.",
      image: "https://example.com/blog/pour-over-hero.jpg",
      datePublished: "2026-09-12",
      dateModified: "2026-10-01",
      author: [{ "@type": "Person", name: "Sam Rivera", url: "https://example.com/team/sam" }],
      "publisher.name": "Blue Door Coffee",
      "publisher.logo.url": "https://example.com/logo.png",
      mainEntityOfPage: "https://example.com/blog/pour-over",
    },
  },

  SoftwareApplication: {
    type: "SoftwareApplication",
    label: "Software App",
    description: "Ratings and price for apps, plugins and SaaS products.",
    richResult: "Software app rich result",
    docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/software-app",
    fields: [
      { key: "@type", label: "App type", type: "select", defaultValue: "SoftwareApplication", options: opts("SoftwareApplication", "WebApplication", "MobileApplication", "VideoGame") },
      { key: "name", label: "App name", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
      { key: "url", label: "URL", type: "url" },
      { key: "image", label: "Icon / screenshot URL", type: "url" },
      { key: "operatingSystem", label: "Operating system", type: "text", recommended: true, placeholder: "Web, macOS, Windows" },
      {
        key: "applicationCategory",
        label: "Category",
        type: "select",
        recommended: true,
        options: opts(
          "BusinessApplication", "DesignApplication", "DeveloperApplication", "EducationalApplication",
          "EntertainmentApplication", "FinanceApplication", "GameApplication", "HealthApplication",
          "LifestyleApplication", "MultimediaApplication", "SecurityApplication", "SocialNetworkingApplication",
          "TravelApplication", "UtilitiesApplication",
        ),
      },
      { key: "softwareVersion", label: "Version", type: "text" },
      { ...OFFER_FIELDS[0]!, required: true, help: "Use 0 for free apps." },
      { ...OFFER_FIELDS[1]!, required: true },
      ...RATING_FIELDS,
    ],
    example: {
      "@type": "WebApplication",
      name: "Visual SEO & Schema Suite",
      description: "Bulk alt text, meta descriptions, WCAG audits and JSON-LD for Framer and Webflow.",
      url: "https://example.com/visual-seo",
      operatingSystem: "Web",
      applicationCategory: "DesignApplication",
      softwareVersion: "1.0.0",
      "offers.price": 0,
      "offers.priceCurrency": "USD",
      "aggregateRating.ratingValue": 4.9,
      "aggregateRating.reviewCount": 41,
    },
  },
}

export const SCHEMA_TYPES = Object.keys(SCHEMA_DEFINITIONS) as SchemaType[]

/** Nested object types inferred from the property name when building JSON-LD. */
export const NESTED_TYPES: Record<string, string> = {
  address: "PostalAddress",
  geo: "GeoCoordinates",
  offers: "Offer",
  aggregateRating: "AggregateRating",
  reviewRating: "Rating",
  acceptedAnswer: "Answer",
  brand: "Brand",
  publisher: "Organization",
  logo: "ImageObject",
  author: "Person",
}

/** Initial form values: defaults + empty lists. */
export function emptyFormData(type: SchemaType): SchemaFormData {
  const data: SchemaFormData = {}
  for (const f of SCHEMA_DEFINITIONS[type].fields) {
    if (f.defaultValue !== undefined) data[f.key] = f.defaultValue as SchemaFormValue
    else if (f.type === "list") data[f.key] = []
  }
  return data
}
