// PORTED FROM the bolo-keyboard app:
//   bolo-update/src/test/java/ai/bolo/update/ui/BoloWavyRingMathTest.kt
// The numbers behind the wavy progress ring are pinned here so a change to
// the ring's geometry cannot slip through unnoticed.
package com.imgvault.app.ui.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoloWavyRingMathTest {

    @Test
    fun `a null progress reads as zero and everything else clamps`() {
        assertEquals(0f, wavyTargetProgress(null), 0.0001f)
        assertEquals(0f, wavyTargetProgress(-1f), 0.0001f)
        assertEquals(1f, wavyTargetProgress(2f), 0.0001f)
        assertEquals(0.42f, wavyTargetProgress(0.42f), 0.0001f)
    }

    @Test
    fun `the wave is flat below 10% and above 95%`() {
        assertEquals(0f, wavyIndicatorAmplitude(0f), 0.0001f)
        assertEquals(0f, wavyIndicatorAmplitude(0.10f), 0.0001f)
        assertEquals(1f, wavyIndicatorAmplitude(0.5f), 0.0001f)
        assertEquals(1f, wavyIndicatorAmplitude(0.94f), 0.0001f)
        assertEquals(0f, wavyIndicatorAmplitude(0.95f), 0.0001f)
        assertEquals(0f, wavyIndicatorAmplitude(1f), 0.0001f)
    }

    @Test
    fun `accessibility flattens the wave and an unknown total keeps it full`() {
        assertEquals(0f, wavyTargetAmplitude(true, 0.5f, 0.5f), 0.0001f)
        assertEquals(1f, wavyTargetAmplitude(false, null, 0f), 0.0001f)
        assertEquals(1f, wavyTargetAmplitude(false, 0.5f, 0.5f), 0.0001f)
    }

    @Test
    fun `the ring radius is half the box minus half the stroke`() {
        assertEquals(105f, wavyRingRadius(220f, 10f), 0.0001f)
    }

    @Test
    fun `the vertex count keeps the wavelength constant and never drops below 5`() {
        // 2*pi*105 / 30 = ~21.99 -> 22
        assertEquals(22, wavyRingVertexCount(220f, 10f, 30f))
        assertEquals(5, wavyRingVertexCount(220f, 10f, 1000f))
    }

    @Test
    fun `the track segment is whole at 0% and shrinks with the progress`() {
        val trackLength = 660f
        val gap = 4f
        val stroke = 10f

        val atZero = wavyTrackSegment(0f, trackLength, gap, stroke)
        assertNotNull(atZero)
        assertEquals(0f, atZero!!.start, 0.001f)
        assertEquals(trackLength, atZero.stop, 0.001f)

        val atHalf = wavyTrackSegment(0.5f, trackLength, gap, stroke)
        assertNotNull(atHalf)
        // pStop 330 + spacing (2 * cap inset 5 + track gap 4 = 14) = 344
        assertEquals(344f, atHalf!!.start, 0.001f)
        assertEquals(646f, atHalf.stop, 0.001f)
        assertTrue(atHalf.stop < trackLength)

        // the progress plus its gap ate the whole track
        assertNull(wavyTrackSegment(1f, trackLength, gap, stroke))
    }

    @Test
    fun `the wave travels one wavelength per second and loops seamlessly`() {
        val singleLength = 660f
        val numVertices = 22

        assertEquals(0f, wavyWaveTravel(0f, 0.5f, singleLength, numVertices), 0.0001f)
        // one full phase = one wavelength = singleLength / numVertices
        assertEquals(
            singleLength / numVertices,
            wavyWaveTravel(1f, 1f, singleLength, numVertices),
            0.0001f,
        )
        assertEquals(
            singleLength / numVertices / 2f,
            wavyWaveTravel(1f, 0.5f, singleLength, numVertices),
            0.0001f,
        )
    }

    @Test
    fun `the progress arc starts where the wave is and runs the progress length`() {
        val singleLength = 660f
        val arc = wavyProgressArc(0.25f, 30f, singleLength)
        assertNotNull(arc)
        assertEquals(30f, arc!!.start, 0.001f)
        assertEquals(30f + 165f, arc.stop, 0.001f)
        assertNull(wavyProgressArc(0f, 0f, singleLength))
    }

    @Test
    fun `the shift angle is the travelled fraction of a full turn`() {
        assertEquals(0f, wavyShiftAngle(0f, 660f), 0.001f)
        assertEquals(180f, wavyShiftAngle(330f, 660f), 0.001f)
        assertEquals(360f, wavyShiftAngle(660f, 660f), 0.001f)
    }

    @Test
    fun `the indeterminate arc is a quarter of the ring`() {
        val arc = wavyIndeterminateArc(0.5f, 660f)
        assertEquals(330f, arc.start, 0.001f)
        assertEquals(330f + 165f, arc.stop, 0.001f)
    }

    @Test
    fun `the centre readout shows the percent, or an ellipsis when unknown`() {
        assertEquals("42%", wavyPercentText(0.42f, 0.42f))
        assertEquals("…", wavyPercentText(null, 0f))
    }

    @Test
    fun `the megabyte readouts follow the progress`() {
        assertEquals(1.0, wavyTotalMb(1024L * 1024L), 0.0001)
        assertEquals(0.5, wavyDownloadedMb(1024L * 1024L, 0.5f), 0.0001)
    }
}
