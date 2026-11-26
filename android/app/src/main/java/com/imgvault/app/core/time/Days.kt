package com.imgvault.app.core.time

import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * The day of a timestamp, as "2026-11-26".
 *
 * The timestamps come in a few shapes ("2026-11-26 03:54:38.281+00",
 * "2026-11-26T03:54:38.280Z"), so the first ten characters are the day.
 *
 * @return the ISO day, or null when the text holds no day
 */
fun isoDayOf(stamp: String): String? {
    val text = stamp.trim()
    if (text.length < 10) return null
    return parseIsoDay(text.take(10))?.toString()
}

/**
 * The day of an ISO day string.
 *
 * @return the date, or null when the text is not a day
 */
fun parseIsoDay(day: String?): LocalDate? {
    if (day.isNullOrBlank()) return null
    return try {
        LocalDate.parse(day.trim(), DateTimeFormatter.ISO_LOCAL_DATE)
    } catch (error: Exception) {
        null
    }
}
