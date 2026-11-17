// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.sync

import java.io.InputStream
import java.util.AbstractMap.SimpleImmutableEntry
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encoding.CompositeDecoder
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.*

/** Keep per-track details encoded; only a requested track becomes a JSON tree. */
@OptIn(ExperimentalSerializationApi::class)
internal class SnapshotJson(private val json: Json) {
    fun read(input: InputStream): JsonObject = json.decodeFromStream(SnapshotSerializer, input)

    private object SnapshotSerializer : KSerializer<JsonObject> {
        override val descriptor = MapSerializer(String.serializer(), JsonElement.serializer()).descriptor

        override fun deserialize(decoder: Decoder): JsonObject {
            val map = decoder.beginStructure(descriptor)
            val fields = linkedMapOf<String, JsonElement>()
            while (true) {
                val keyIndex = map.decodeElementIndex(descriptor)
                if (keyIndex == CompositeDecoder.DECODE_DONE) break
                val name = map.decodeStringElement(descriptor, keyIndex)
                val valueIndex = map.decodeElementIndex(descriptor)
                require(valueIndex == keyIndex + 1) { "Missing snapshot value" }
                val serializer = if (name in details) DetailsSerializer else JsonElement.serializer()
                fields[name] = map.decodeSerializableElement(descriptor, valueIndex, serializer)
            }
            map.endStructure(descriptor)
            return JsonObject(fields)
        }

        override fun serialize(encoder: Encoder, value: JsonObject) =
            JsonObject.serializer().serialize(encoder, value)
    }

    private object DetailsSerializer : KSerializer<JsonElement> {
        private val encoded = MapSerializer(String.serializer(), EncodedValueSerializer).nullable
        override val descriptor = encoded.descriptor

        override fun deserialize(decoder: Decoder): JsonElement {
            val values = decoder.decodeSerializableValue(encoded) ?: return JsonNull
            return JsonObject(EncodedMap((decoder as JsonDecoder).json, values))
        }

        override fun serialize(encoder: Encoder, value: JsonElement) =
            JsonElement.serializer().serialize(encoder, value)
    }

    private object EncodedValueSerializer : KSerializer<String> {
        override val descriptor = JsonElement.serializer().descriptor

        // The JSON decoder consumes only this track, never the whole details map.
        override fun deserialize(decoder: Decoder): String =
            (decoder as JsonDecoder).decodeJsonElement().toString()

        override fun serialize(encoder: Encoder, value: String) {
            val jsonEncoder = encoder as JsonEncoder
            jsonEncoder.encodeJsonElement(jsonEncoder.json.parseToJsonElement(value))
        }
    }

    private class EncodedMap(private val json: Json, private val encoded: Map<String, String>) :
        AbstractMap<String, JsonElement>() {
        override val size: Int get() = encoded.size
        override fun containsKey(key: String): Boolean = encoded.containsKey(key)
        override fun get(key: String): JsonElement? = encoded[key]?.let(json::parseToJsonElement)
        override val entries: Set<Map.Entry<String, JsonElement>> = object : AbstractSet<Map.Entry<String, JsonElement>>() {
            override val size: Int get() = encoded.size
            override fun iterator(): Iterator<Map.Entry<String, JsonElement>> {
                val source = encoded.entries.iterator()
                return object : Iterator<Map.Entry<String, JsonElement>> {
                    override fun hasNext(): Boolean = source.hasNext()
                    override fun next(): Map.Entry<String, JsonElement> {
                        val entry = source.next()
                        return SimpleImmutableEntry(entry.key, json.parseToJsonElement(entry.value))
                    }
                }
            }
        }
    }

    private companion object {
        val details = setOf("lyrics", "waveforms")
    }
}
