// PORTED FROM the bolo-keyboard app (Material 3 Expressive wavy progress ring):
//   bolo-update/src/main/java/ai/bolo/update/ui/BoloWavyProgress.kt
// The ring itself is unchanged — same geometry, same easing, same M3 numbers.
// The bolo-specific icons/badge were swapped for Material icons so this app
// does not carry a second icon set.
package com.imgvault.app.ui.update

import android.content.Context
import android.view.accessibility.AccessibilityManager
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.graphics.shapes.Cubic
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.atan2

/**
 * Material 3 Expressive wavy progress ring, matching Morphe Manager's
 * `WavyProgressRing` curve-for-curve.
 *
 * Morphe uses M3's own `CircularWavyProgressIndicator` (material3 1.5.0-rc01),
 * which does NOT draw a sine wave: it morphs a circle into a rounded star
 * polygon (`RoundedPolygon.star`, inner radius 0.75) and cuts the progress arc
 * out of the full wavy circle with a `PathMeasure`, so the wavelength stays
 * constant as the arc grows. The wave is flat below 10% and above 95%
 * progress, and travels at one wavelength per second.
 *
 * We replicate that exact rendering here with `androidx.graphics:graphics-shapes`
 * (the same library M3 uses) instead of taking the real component, because it
 * needs material3 1.5.0-rc01 + Compose 1.12, and that upgrade is not something
 * to take days before launch. The numbers below are copied from M3 1.5.0-rc01
 * (`WavyProgressIndicator.kt`, `CircularWavyProgressModifiers.kt`):
 * wavelength 30.dp (Morphe's dialog value), gap 4.dp, star inner radius 0.75,
 * rounding 0.35/0.4, inner rounding 0.5, amplitude specs 500ms.
 */
@Composable
fun BoloWavyProgressRing(
    progress: Float?,
    totalSizeBytes: Long,
    caption: String,
    modifier: Modifier = Modifier,
    ringSize: Dp = 220.dp,
    strokeWidth: Dp = 10.dp,
    wavelength: Dp = 30.dp,
) {
    // Morphe eases progress with tween(220); Compose's tween default easing is
    // FastOutSlowIn, same as here. M3 itself reads the progress lambda raw.
    val targetProgress = wavyTargetProgress(progress)
    val animatedProgress by animateFloatAsState(
        targetValue = targetProgress,
        animationSpec = tween(durationMillis = 220, easing = FastOutSlowInEasing),
        label = "wavyProgress",
    )

    val ringScale = remember { Animatable(0.85f) }
    LaunchedEffect(Unit) {
        ringScale.animateTo(
            targetValue = 1f,
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioLowBouncy,
                stiffness = Spring.StiffnessLow,
            ),
        )
    }

    // Morphe flattens the wave while TalkBack touch exploration is on.
    val accessibilityOn = rememberBoloAccessibilityEnabled()
    val targetAmplitude = wavyTargetAmplitude(accessibilityOn, progress, animatedProgress)
    val amplitude = remember { Animatable(0f) }
    LaunchedEffect(targetAmplitude) {
        amplitude.animateTo(
            targetValue = targetAmplitude,
            animationSpec = tween(
                durationMillis = 500,
                easing = if (targetAmplitude > amplitude.value) {
                    WavyStandardEasing
                } else {
                    WavyEmphasizedAccelerateEasing
                },
            ),
        )
    }

    // Wave travel: 1 wavelength per second, like M3 (waveSpeed defaults to the
    // wavelength). The pattern repeats every wavelength, so a 0..1 phase over 1s
    // loops seamlessly.
    val infinite = rememberInfiniteTransition(label = "wavyPhase")
    val wavePhase by infinite.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "wavePhase",
    )
    // Indeterminate arc sweep: one full turn per 2s.
    val sweepPhase by infinite.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "sweepPhase",
    )

    val density = LocalDensity.current
    val sizePx = with(density) { ringSize.toPx() }
    val strokePx = with(density) { strokeWidth.toPx() }
    val wavelengthPx = with(density) { wavelength.toPx() }
    val gapPx = with(density) { WavyTrackGap.toPx() }

    // Circle/star polygons + morph, rebuilt only when the geometry changes.
    val shapes = remember(sizePx, strokePx, wavelengthPx) {
        wavyRingShapes(sizePx, strokePx, wavelengthPx)
    }

    // Full wavy circle (doubled, so the travelling wave can wrap around),
    // rebuilt when the amplitude moves; the track never depends on it.
    val fullProgressPath = remember(shapes, amplitude.value, sizePx, strokePx) {
        buildWavyRingPath(
            cubics = shapes.morph.asCubics(amplitude.value),
            repeatPath = true,
            sizePx = sizePx,
            strokePx = strokePx,
        )
    }
    val fullTrackPath = remember(shapes, sizePx, strokePx) {
        buildWavyRingPath(
            cubics = shapes.trackCubics,
            repeatPath = false,
            sizePx = sizePx,
            strokePx = strokePx,
        )
    }
    val progressMeasure = remember { PathMeasure() }
    val trackMeasure = remember { PathMeasure() }
    val segmentPath = remember { Path() }
    val trackSegmentPath = remember { Path() }

    val primaryColor = MaterialTheme.colorScheme.primary
    val trackColor = MaterialTheme.colorScheme.surfaceVariant

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            modifier = Modifier
                .size(ringSize)
                .graphicsLayer {
                    scaleX = ringScale.value
                    scaleY = ringScale.value
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val center = Offset(size.width / 2f, size.height / 2f)
                progressMeasure.setPath(fullProgressPath, forceClosed = true)
                // The progress path is doubled for the travelling wave.
                val singleLength = progressMeasure.length / 2f
                trackMeasure.setPath(fullTrackPath, forceClosed = true)
                val trackLength = trackMeasure.length

                // Remaining track arc, shortened at both ends by the M3 gap
                // (stroke cap + 4.dp), taken out of the track, not the arc.
                val trackSegment = wavyTrackSegment(animatedProgress, trackLength, gapPx, strokePx)
                if (trackSegment != null) {
                    trackSegmentPath.rewind()
                    trackMeasure.getSegment(
                        startDistance = trackSegment.start,
                        stopDistance = trackSegment.stop,
                        destination = trackSegmentPath,
                        startWithMoveTo = true,
                    )
                    drawPath(
                        path = trackSegmentPath,
                        color = trackColor,
                        style = Stroke(width = strokePx, cap = StrokeCap.Round),
                    )
                }

                // Active wavy arc, cut from the full wavy circle so the
                // wavelength never stretches with progress.
                if (progress != null) {
                    val waveTravel = wavyWaveTravel(
                        amplitude.value,
                        wavePhase,
                        singleLength,
                        shapes.numVertices,
                    )
                    val arc = wavyProgressArc(animatedProgress, waveTravel, singleLength)
                    if (arc != null) {
                        segmentPath.rewind()
                        progressMeasure.getSegment(
                            startDistance = arc.start,
                            stopDistance = arc.stop,
                            destination = segmentPath,
                            startWithMoveTo = true,
                        )
                        // Rotate the cut segment back so the arc stays fixed
                        // while the wave pattern travels along it.
                        val shiftAngle = wavyShiftAngle(waveTravel, singleLength)
                        if (shiftAngle != 0f) {
                            segmentPath.translate(Offset(-center.x, -center.y))
                            segmentPath.transform(
                                Matrix().apply { rotateZ(-shiftAngle) },
                            )
                            segmentPath.translate(center)
                        }
                        drawPath(
                            path = segmentPath,
                            color = primaryColor,
                            style = Stroke(
                                width = strokePx,
                                cap = StrokeCap.Round,
                                join = StrokeJoin.Round,
                            ),
                        )
                    }
                } else {
                    // Unknown total: a quarter-arc sweeping around the ring.
                    val sweep = wavyIndeterminateArc(sweepPhase, singleLength)
                    segmentPath.rewind()
                    progressMeasure.getSegment(
                        startDistance = sweep.start,
                        stopDistance = sweep.stop,
                        destination = segmentPath,
                        startWithMoveTo = true,
                    )
                    drawPath(
                        path = segmentPath,
                        color = primaryColor,
                        style = Stroke(
                            width = strokePx,
                            cap = StrokeCap.Round,
                            join = StrokeJoin.Round,
                        ),
                    )
                }
            }

            // Center readout: percentage + MB / Total MB
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                val pctText = wavyPercentText(progress, animatedProgress)
                Text(
                    text = pctText,
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (totalSizeBytes > 0L) {
                    val totalMb = wavyTotalMb(totalSizeBytes)
                    val downloadedMb = wavyDownloadedMb(totalSizeBytes, animatedProgress)
                    Text(
                        text = "%.1f / %.1f MB".format(downloadedMb, totalMb),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }

        Text(
            text = caption,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/** M3 `MotionTokens.EasingStandardCubicBezier`, for growing the wave. */
private val WavyStandardEasing = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** M3 `MotionTokens.EasingEmphasizedAccelerateCubicBezier`, for shrinking the wave. */
private val WavyEmphasizedAccelerateEasing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)

/** M3 `CircularProgressIndicatorTokens.TrackActiveSpace`. */
private val WavyTrackGap = 4.dp

/**
 * Builds a scaled, centred ring path from graphics-shapes cubics, following
 * M3's `ShapeUtil.pathFromCubics` + `CircularProgressDrawingCache.processPath`:
 * cubic path starting at 12 o'clock, optionally repeated twice (so a travelling
 * segment can wrap past the end), scaled to (size - stroke) and centred.
 */
private fun buildWavyRingPath(
    cubics: List<Cubic>,
    repeatPath: Boolean,
    sizePx: Float,
    strokePx: Float,
): Path {
    val path = Path()
    var first = true
    for (cubic in cubics) {
        if (first) {
            path.moveTo(cubic.anchor0X, cubic.anchor0Y)
            first = false
        }
        path.cubicTo(
            cubic.control0X,
            cubic.control0Y,
            cubic.control1X,
            cubic.control1Y,
            cubic.anchor1X,
            cubic.anchor1Y,
        )
    }
    if (repeatPath) {
        var firstInRepeat = true
        for (cubic in cubics) {
            if (firstInRepeat) {
                path.lineTo(cubic.anchor0X, cubic.anchor0Y)
                firstInRepeat = false
            }
            path.cubicTo(
                cubic.control0X,
                cubic.control0Y,
                cubic.control1X,
                cubic.control1Y,
                cubic.anchor1X,
                cubic.anchor1Y,
            )
        }
    }
    path.close()
    // Rotate so the path starts at 12 o'clock (startAngle 270 in M3).
    // Normalized polygons are centred at (0.5, 0.5).
    val angleToFirst = atan2(
        cubics[0].anchor0Y - 0.5f,
        cubics[0].anchor0X - 0.5f,
    ) * 180f / PI.toFloat()
    path.transform(Matrix().apply { rotateZ(-angleToFirst + 270f) })
    // Scale to (size - stroke), then centre in the box.
    path.transform(Matrix().apply { scale(sizePx - strokePx, sizePx - strokePx) })
    val bounds = path.getBounds()
    path.translate(Offset(sizePx / 2f - bounds.center.x, sizePx / 2f - bounds.center.y))
    return path
}

/**
 * True when any accessibility service with touch exploration is active
 * (e.g. TalkBack). Ported from Morphe Manager's `rememberAccessibilityEnabled`.
 */
@Composable
private fun rememberBoloAccessibilityEnabled(): Boolean {
    val context = LocalContext.current
    val manager = remember(context) {
        context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    }
    var enabled by remember {
        mutableStateOf(manager.isEnabled && manager.isTouchExplorationEnabled)
    }
    DisposableEffect(manager) {
        val stateListener = AccessibilityManager.AccessibilityStateChangeListener {
            enabled = manager.isEnabled && manager.isTouchExplorationEnabled
        }
        val touchListener = AccessibilityManager.TouchExplorationStateChangeListener {
            enabled = manager.isEnabled && manager.isTouchExplorationEnabled
        }
        manager.addAccessibilityStateChangeListener(stateListener)
        manager.addTouchExplorationStateChangeListener(touchListener)
        onDispose {
            manager.removeAccessibilityStateChangeListener(stateListener)
            manager.removeTouchExplorationStateChangeListener(touchListener)
        }
    }
    return enabled
}

/**
 * Pulsing app badge with caption for the `Installing` state, ported from
 * Morphe Manager (`PulsingLogoWithCaption`).
 */
@Composable
fun BoloPulsingInstallIndicator(
    title: String,
    subtitle: String,
    methodBadge: String,
    modifier: Modifier = Modifier,
) {
    val infinite = rememberInfiniteTransition(label = "installPulse")
    val scale by infinite.animateFloat(
        initialValue = 0.92f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseScale",
    )
    val haloScale by infinite.animateFloat(
        initialValue = 0.95f,
        targetValue = 1.32f,
        animationSpec = infiniteRepeatable(
            animation = tween(1350, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "haloScale",
    )
    val haloAlpha by infinite.animateFloat(
        initialValue = 0.38f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1350, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "haloAlpha",
    )

    val primary = MaterialTheme.colorScheme.primary

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier.size(116.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(88.dp)
                    .graphicsLayer {
                        scaleX = haloScale
                        scaleY = haloScale
                        alpha = haloAlpha
                    }
                    .clip(CircleShape)
                    .background(primary),
            )
            Surface(
                modifier = Modifier
                    .size(76.dp)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                    },
                shape = RoundedCornerShape(22.dp),
                color = primary.copy(alpha = 0.15f),
                border = BorderStroke(1.5.dp, primary.copy(alpha = 0.4f)),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Filled.SystemUpdate,
                        contentDescription = null,
                        tint = primary,
                        modifier = Modifier.size(38.dp),
                    )
                }
            }
        }

        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        // Rule 8: always show the active install engine/method badge visibly
        UpdateMethodBadge(text = methodBadge)
    }
}

/** The visible badge that names the install method (never implied). */
@Composable
fun UpdateMethodBadge(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.primaryContainer,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.PhoneAndroid,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(14.dp),
            )
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

/**
 * Spring-overshoot `80.dp` green check circle for `State.Installed`, ported from
 * Morphe Manager (`UpdateCompletedContent`).
 */
@Composable
fun BoloUpdateCompletedView(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
) {
    val iconScale = remember { Animatable(0f) }
    val textAlpha = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        launch {
            iconScale.animateTo(
                targetValue = 1f,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioMediumBouncy,
                    stiffness = Spring.StiffnessLow,
                ),
            )
        }
        launch {
            delay(150)
            textAlpha.animateTo(1f, tween(250))
        }
    }

    val successGreen = Color(0xFF22C55E)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(80.dp)
                .graphicsLayer {
                    scaleX = iconScale.value
                    scaleY = iconScale.value
                }
                .clip(CircleShape)
                .background(successGreen.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = successGreen,
                modifier = Modifier.size(44.dp),
            )
        }

        Column(
            modifier = Modifier.graphicsLayer { alpha = textAlpha.value },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}
