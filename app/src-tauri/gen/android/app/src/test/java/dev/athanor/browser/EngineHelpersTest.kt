package dev.athanor.browser

import org.junit.Assert.assertEquals
import org.junit.Test

class EngineHelpersTest {
    @Test
    fun cssBoundsUseDisplayDensity() {
        assertEquals(30, EngineGeometry.cssToPx(10.0, 3f))
        assertEquals(15, EngineGeometry.cssToPx(10.0, 1.5f))
    }

    @Test
    fun classifiesResourceTypesFromMetadataAndSuffixes() {
        assertEquals(0, RequestKindClassifier.classify("https://site.test/", true, emptyMap()))
        assertEquals(3, RequestKindClassifier.classify("https://cdn.test/app.js", false, emptyMap()))
        assertEquals(2, RequestKindClassifier.classify("https://cdn.test/app", false, mapOf("Accept" to "text/css,*/*")))
        assertEquals(5, RequestKindClassifier.classify("https://cdn.test/font.woff2", false, emptyMap()))
        assertEquals(1, RequestKindClassifier.classify("https://site.test/frame", false, mapOf("Sec-Fetch-Dest" to "iframe")))
    }
}
