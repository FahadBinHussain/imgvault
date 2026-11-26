// PORTED FROM the bolo-keyboard app (Material 3 Expressive wavy progress ring):
//   bolo-update/src/main/java/ai/bolo/update/ui/BoloWavyRingMath.kt
// Only the package changed — the numbers are the ones M3 1.5.0-rc01 uses, and
// they are pinned by the JVM unit test next to this file.
package com.imgvault.app.ui.update

import androidx.graphics.shapes.CornerRounding
import androidx.graphics.shapes.Cubic
import androidx.graphics.shapes.Morph
import androidx.graphics.shapes.RoundedPolygon
import androidx.graphics.shapes.circle
import androidx.graphics.shapes.star
import kotlin.math.PI
import kotlin.math.roundToInt

/**
 * Pure math behind [BoloWavyProgressRing], extracted so the regression tests
 * can pin it on the JVM.
 *
 * The composable keeps doing the drawing (Canvas, PathMeasure, Animatable),
 * but every number that decides *what* gets drawn lives here: progress
 * clamping, the M3 amplitude rule, the vertex count, the track-gap insets,
 * the travelling-wave offset and the arc cuts. A change to any of them that
 * is not a deliberate visual change breaks a test instead of silently changing
 * the ring.
 *
 * Everything here is dependency-free float math, except [wavyRingShapes],
 * which builds the circle/star morph out of `androidx.graphics:graphics-shapes`
 * — that library is pure Kotlin (no android.* references in its classes, so
 * it runs on the JVM). The path building stays in the composable file: it
 * uses Compose `Path`/`Matrix`, which are Android-stubbed and cannot run in a
 * unit test.
 */

/** A cut out of a ring path, as distances along the path from its start. */
internal data class WavyArcSegment(val start: Float, val stop: Float)

/** The circle/star polygons and their morph, rebuilt when the geometry changes. */
internal class WavyRingShapes(
    val numVertices: Int,
    val morph: Morph,
    val trackCubics: List<Cubic>,
)

/** Null progress (unknown total) reads as 0, and anything outside 0..1 clamps. */
internal fun wavyTargetProgress(progress: Float?): Float =
    (progress ?: 0f).coerceIn(0f, 1f)

/**
 * M3 `WavyProgressIndicatorDefaults.indicatorAmplitude`: the wave is flat
 * below 10% and above 95% progress, full in between.
 */
internal fun wavyIndicatorAmplitude(progress: Float): Float =
    if (progress <= 0.1f || progress >= 0.95f) 0f else 1f

/**
 * The wave amplitude the ring animates towards: flat while TalkBack touch
 * exploration is on, full while the total is unknown, otherwise the M3
 * amplitude rule on the animated progress.
 */
internal fun wavyTargetAmplitude(
    accessibilityOn: Boolean,
    progress: Float?,
    animatedProgress: Float,
): Float = when {
    accessibilityOn -> 0f
    progress == null -> 1f
    else -> wavyIndicatorAmplitude(animatedProgress)
}

/** Ring centreline radius: half the box minus half the stroke. */
internal fun wavyRingRadius(sizePx: Float, strokePx: Float): Float =
    sizePx / 2f - strokePx / 2f

/**
 * How many star vertices the ring needs so the wavelength stays constant:
 * circumference / wavelength, rounded, never below 5 (a star with fewer
 * points stops looking like a ring).
 */
internal fun wavyRingVertexCount(sizePx: Float, strokePx: Float, wavelengthPx: Float): Int =
    (2 * PI * wavyRingRadius(sizePx, strokePx) / wavelengthPx).roundToInt().coerceAtLeast(5)

/**
 * The morph M3's wavy indicator is built on: a circle morphed into a rounded
 * star (`RoundedPolygon.star`, inner radius 0.75). Amplitude 0 draws the
 * circle, amplitude 1 the star. Numbers copied from M3 1.5.0-rc01.
 */
internal fun wavyRingShapes(sizePx: Float, strokePx: Float, wavelengthPx: Float): WavyRingShapes {
    val numVertices = wavyRingVertexCount(sizePx, strokePx, wavelengthPx)
    val track = RoundedPolygon.circle(numVertices = numVertices).normalized()
    val star = RoundedPolygon.star(
        numVerticesPerRadius = numVertices,
        innerRadius = 0.75f,
        rounding = CornerRounding(radius = 0.35f, smoothing = 0.4f),
        innerRounding = CornerRounding(radius = 0.5f),
    ).normalized()
    return WavyRingShapes(
        numVertices = numVertices,
        morph = Morph(start = track, end = star),
        trackCubics = track.cubics,
    )
}

/**
 * The remaining track arc, shortened at both ends by the M3 gap (stroke cap +
 * track gap), taken out of the track, not the progress arc. The gap and
 * the cap inset never exceed how far the progress has got, so the track is
 * whole at 0% — and null once the progress plus its gap eats the whole track.
 */
internal fun wavyTrackSegment(
    progress: Float,
    trackLength: Float,
    gapPx: Float,
    strokePx: Float,
): WavyArcSegment? {
    val pStop = progress * trackLength
    val trackGap = pStop.coerceAtMost(gapPx)
    val insets = pStop.coerceAtMost(strokePx / 2f)
    val spacing = insets * 2f + trackGap
    val tStart = pStop + spacing
    val tStop = trackLength - spacing
    return if (tStop > tStart) WavyArcSegment(tStart, tStop) else null
}

/**
 * How far along the doubled progress path the travelling wave has moved: one
 * wavelength per second, so a 0..1 phase over 1s moves exactly one wavelength
 * (`singleLength / numVertices`) and loops seamlessly. Flat when the wave is.
 */
internal fun wavyWaveTravel(
    amplitude: Float,
    wavePhase: Float,
    singleLength: Float,
    numVertices: Int,
): Float = if (amplitude > 0f) {
    wavePhase * (singleLength / numVertices)
} else {
    0f
}

/**
 * The active determinate arc, cut from the doubled progress path so the
 * wavelength never stretches with progress. Null when there is nothing to
 * draw yet. The stop may run past [singleLength] — that is what the doubled
 * path is for.
 */
internal fun wavyProgressArc(
    progress: Float,
    waveTravel: Float,
    singleLength: Float,
): WavyArcSegment? {
    val arcLength = progress * singleLength
    return if (arcLength > 0f) WavyArcSegment(waveTravel, waveTravel + arcLength) else null
}

/**
 * Rotation (degrees) that holds the cut arc fixed while the wave pattern
 * travels along it: the travelled fraction of one full turn.
 */
internal fun wavyShiftAngle(waveTravel: Float, singleLength: Float): Float =
    waveTravel / singleLength * 360f

/** Indeterminate arc: a quarter of the ring, sweeping one full turn per cycle. */
internal fun wavyIndeterminateArc(sweepPhase: Float, singleLength: Float): WavyArcSegment {
    val sweepStart = sweepPhase * singleLength
    return WavyArcSegment(sweepStart, sweepStart + singleLength * 0.25f)
}

/** Centre readout: whole percent while the total is known, an ellipsis while not. */
internal fun wavyPercentText(progress: Float?, animatedProgress: Float): String =
    if (progress != null) {
        "${(animatedProgress * 100).roundToInt()}%"
    } else {
        "…"
    }

/** Total size in MiB. */
internal fun wavyTotalMb(totalSizeBytes: Long): Double =
    totalSizeBytes / (1024.0 * 1024.0)

/** Downloaded so far in MiB, at the animated progress. */
internal fun wavyDownloadedMb(totalSizeBytes: Long, animatedProgress: Float): Double =
    wavyTotalMb(totalSizeBytes) * animatedProgress.toDouble()
