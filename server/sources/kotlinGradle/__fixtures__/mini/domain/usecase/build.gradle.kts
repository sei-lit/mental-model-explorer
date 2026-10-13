plugins {
    id("usapo.primitive.kmp")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            api(projects.domain.model)
            api(projects.core)
        }
    }
}
