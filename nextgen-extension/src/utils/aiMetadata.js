export const AI_METADATA_SCHEMA_VERSION = 1;
export const AI_METADATA_STATUS_NOT_GENERATED = 'not_generated';

const isPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value)
);

const toStringValue = (value) => (typeof value === 'string' ? value : '');
const toArrayValue = (value) => (Array.isArray(value) ? value : []);
const toObjectValue = (value) => (isPlainObject(value) ? value : {});

export function createEmptyAiAnalysis() {
  return {
    caption: '',
    description: '',
    objects: [],
    dominantObjects: [],
    scene: '',
    tags: [],
    tagsConfidence: {},
    containsPeople: false,
    peopleCount: 0,
    possibleActivity: '',
    mood: '',
    weather: '',
    orientation: '',
    estimatedLocation: '',
    timeOfDay: '',
    colors: [],
    photoQuality: {
      brightness: '',
      contrast: '',
      sharpness: '',
      blurLevel: '',
      noiseLevel: '',
    },
    ocr: {
      hasText: false,
      text: '',
    },
    safety: {
      nsfw: false,
      violence: false,
      weapons: false,
      drugs: false,
      document: false,
      idCard: false,
      licensePlate: false,
      childPresent: false,
    },
  };
}

export function normalizeAiMetadata(value = {}) {
  const input = toObjectValue(value);
  const analysis = toObjectValue(input.analysis);
  const emptyAnalysis = createEmptyAiAnalysis();
  const confidence = Number(input.confidence);
  const schemaVersion = Number(input.schemaVersion);

  return {
    schemaVersion: Number.isInteger(schemaVersion) && schemaVersion > 0
      ? schemaVersion
      : AI_METADATA_SCHEMA_VERSION,
    status: toStringValue(input.status) || AI_METADATA_STATUS_NOT_GENERATED,
    generatedAt: toStringValue(input.generatedAt),
    provider: toStringValue(input.provider),
    model: toStringValue(input.model),
    promptVersion: toStringValue(input.promptVersion),
    confidence: Number.isFinite(confidence) ? confidence : 0,
    analysis: {
      ...emptyAnalysis,
      ...analysis,
      caption: toStringValue(analysis.caption),
      description: toStringValue(analysis.description),
      objects: toArrayValue(analysis.objects),
      dominantObjects: toArrayValue(analysis.dominantObjects),
      scene: toStringValue(analysis.scene),
      tags: toArrayValue(analysis.tags),
      tagsConfidence: toObjectValue(analysis.tagsConfidence),
      containsPeople: Boolean(analysis.containsPeople),
      peopleCount: Number.isFinite(Number(analysis.peopleCount))
        ? Number(analysis.peopleCount)
        : 0,
      possibleActivity: toStringValue(analysis.possibleActivity),
      mood: toStringValue(analysis.mood),
      weather: toStringValue(analysis.weather),
      orientation: toStringValue(analysis.orientation),
      estimatedLocation: toStringValue(analysis.estimatedLocation),
      timeOfDay: toStringValue(analysis.timeOfDay),
      colors: toArrayValue(analysis.colors),
      photoQuality: {
        ...emptyAnalysis.photoQuality,
        ...toObjectValue(analysis.photoQuality),
      },
      ocr: {
        ...emptyAnalysis.ocr,
        ...toObjectValue(analysis.ocr),
        hasText: Boolean(toObjectValue(analysis.ocr).hasText),
        text: toStringValue(toObjectValue(analysis.ocr).text),
      },
      safety: {
        ...emptyAnalysis.safety,
        ...toObjectValue(analysis.safety),
      },
    },
  };
}

export function ensureAiMetadataContainer(extraMetadata = {}, kind = 'image') {
  const extra = toObjectValue(extraMetadata);

  if (kind !== 'image') {
    return extra;
  }

  return {
    ...extra,
    ai: normalizeAiMetadata(extra.ai),
  };
}
